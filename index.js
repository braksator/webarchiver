'use strict';

var fs = require('fs');
var globby = require('globby');
var minify = require('html-minifier').minify;
var mkdirp = require('mkdirp');
var del = require('del');
var mergeOptions = require('merge-options');
var keyFileStorage = require("key-file-storage");
var isBinaryFile = require("isbinaryfile");
var path = require('path');
var ProgressBar = require('progress');

module.exports = {

    /**
     * The main webarchiver function.
     * @param {object} options - The options.
     * @param {string|array} options.files - A glob pattern that indicates which files to process, or an array of glob strings.
     * @param {string|array} options.justcopy - Glob string/array of files to not process.
     * @param {undefined|null|bool} options.inplace - If set to true will modify the existing files rather than creating new files.
     * @param {string} options.output - The path of an output directory if options.inplace is not used.
     * @param {object|false} options.dedupe - Options to override deduplication behaviour (or set to false to not deduplicate).
     * @param {object|false} options.minify - Options to override minification behaviour as per the html-minifier package (or set to false to not minify).
     * @param {string} options.vfile - The name of the php variables file if 'v.php' is not acceptable.
     * @param {string} options.dbdir - The name of the key-file storage directory if 'vdb' is not acceptable.
     * @param {bool} options.fullnest - Whether to maintain full path nesting in the output directory - defaults to false.
     * @param (int|bool) options.cache = The size of the memory cache in terms of key-values, true for unlimited, false for none.  Defaults to 500.
     * @param {bool|undefined} options.keepdb - Whether to keep the key-file storage after completion, useful for batching.  Default is undefined.
     * @param {array} options.skipcontaining - An array of strings, if a text file contains any of them it will be 'just copied'. Default is ['<?'].
     * @param {bool} options.noprogress - Set to true to remove the progress bar.
     * @param {bool} options.passes - Number of deduplication passes over the files.  Defaults to 2.
     */
    webArchiver: function (options) {

        // Check that there are options.
        if (options == null) {
            throw new Error("No options given.");
        }

        // Check that there is an input pattern.
        if (options.files == null) {
            throw new Error("No input files defined in options.");
        }

        // Check output options make sense.
        if (!options.inplace && !options.output) {
            throw new Error("You must set the 'inplace' option to true or provide an output directory path to 'output'.");
        }

        // Create the output directory (and any necessary subdirectories) if it doesn't exist (ignore the error if it already exists).
        if (options.output) {
            mkdirp.sync(options.output);
        }

        // Set the vfile filename.
        if (!options.vfile) {
            options.vfile = 'v.php';
        }

        // Set the dbdir directory name.
        if (!options.dbdir) {
            options.dbdir = 'vdb';
        }

        // Set the kfs cache file size.
        if (!options.cache) {
            options.cache = 500;
        }

        // Set the number of passes
        if (!options.passes) {
            options.passes = 2;
        }

        // Grab the files.
        if (typeof options.files == 'string') options.files = [options.files];
        options.files.push("!**/" + options.dbdir + "/**");
        options.files.push("!**/" + options.vfile);
        var files = globby.sync(options.files);

        // Just copy file list.
        var justCopy = [];
        if (options.justcopy) {
            justCopy = globby.sync(options.justcopy);
        }

        // Handle skipcontaining default value.  Checks for PHP opening tag.
        if (!options.skipcontaining) {
            options.skipcontaining = ['<?'];
        }

        // Check that there are files.
        if (files === undefined || files.length == 0) {
            throw new Error("No input files found.");
        }

        // Setup minify options.
        if (options.minify !== false) {
            var minify_opts = {
                collapseBooleanAttributes: true,
                collapseInlineTagWhitespace: true,
                collapseWhitespace: true,
                conservativeCollapse: false,
                html5: false,
                minifyCSS: true,
                minifyJS: true,
                removeAttributeQuotes: true,
                removeComments: true,
                removeEmptyAttributes: true,
                removeRedundantAttributes: true,
                removeScriptTypeAttributes: true,
                removeStyleLinkTypeAttributes: true
            };
            options.minify = mergeOptions(minify_opts, options);
        }

        // Setup dedupe options.
        if (options.dedupe !== false) {
            var dedupe_opts = {
                minLength: 10,
                minSaving: 4,
                startsWith: ['<', '{', '\\(', '\\[', '"'],
                endsWith: ['>', '}', '\\)', '\\]', '"', '\\n', '\\s']
            };
            options.dedupe = mergeOptions(dedupe_opts, options);
        }

        // Get the common prefix directories of all the files.
        var startPath = this.startPath(files);

        // Where to output the files.
        var outDir = this.outDir(startPath, options.inplace, options.output, options.fullnest);

        // Process the files.
        this.processFiles(files, justCopy, startPath, outDir, options);

        if (!options.keepdb) {
            del.sync(outDir + options.dbdir);
        }

    },

    // File processing function.
    processFiles: function (files, justCopy, startPath, outDir, options) {

        // Number of files.
        var numFiles = files.length;

        // Set up progress bar.
        if (!options.noprogress) {

            var bar = new ProgressBar('  processing [:bar] :percent :etas', {
                width: 100,
                // This is a 1+2+3+4.. algorithm *passes plus one extra tick for writing the vfile.
                total: ((numFiles * (numFiles + 1)) / 2) * options.passes + 1
            });
        }
        else {
            var bar = { tick: function() {} };
        }

        // Length of the start path.
        var startPathLength = startPath.length;

        // The first variable name to use.  Using an array so it can be passed by reference.
        var varName = ['a'];

        // Stored data.
        var wrapped_dir = outDir + options.dbdir + '/wrapped/';
        var wrapped = keyFileStorage(wrapped_dir, options.cache);
        var replacements_dir = outDir + options.dbdir + '/replacements/';
        var replacements = keyFileStorage(replacements_dir, options.cache);
        var replacements_keys = [];

        var skipFiles = {};

        for (var pass = 0; pass < options.passes; ++pass) {

            for (var i = 0; i < numFiles; ++i) {
                if (pass == 0) {
                    // Determine if this file shouldn't be processed.
                    skipFiles[i] = justCopy.indexOf(files[i]) > -1;

                    // Remove old start path from the filename.
                    files[i] = files[i].substr(startPathLength);
                }

                if (fs.lstatSync(startPath + files[i]).isDirectory()) {
                    // Directory.
                    skipFiles[i] = true;
                    bar.tick(i + options.passes);
                }
                else if (!skipFiles[i] && isBinaryFile.sync(startPath + files[i])) {
                    // Process binary files.
                    if (pass == 0) {
                        // Ensure the output dir exists.
                        mkdirp.sync(path.dirname(outDir + files[i]));

                        if (startPath + files[i] != outDir + files[i]) {
                            // Copy the file over.
                            var file = fs.readFileSync(startPath + files[i], 'binary');
                            fs.writeFileSync(outDir + files[i], file, 'binary');
                        }
                    }

                    skipFiles[i] = true;
                    bar.tick(i + options.passes);
                }
                else {
                    // Process text files.

                    // Read the file contents.
                    var fileLoc = (pass == 0 ? startPath + files[i] : outDir + files[i]);
                    var str = fs.readFileSync(fileLoc, 'utf8');

                    // Determine additional skip conditions based on the contents of the file.
                    if (pass == 0 && !skipFiles[i]) {
                        for (var j = 0; j < options.skipcontaining.length; ++j) {
                            if (str.indexOf(options.skipcontaining[j]) > -1) {
                                skipFiles[i] = true;
                                break;
                            }
                        }
                    }

                    // Ensure it's not a file to skip.
                    if (!skipFiles[i]) {
                        // Minify the file contents.
                        if (pass == 0 && options.minify !== false) {
                            str = this.minify(str, options);
                        }

                        if (options.dedupe !== false) {
                            // Apply existing replacements.
                            try {
                                replacements_keys = fs.readdirSync(replacements_dir);
                            }
                            catch (err) {
                                if (err.code !== 'ENOENT') {
                                    /* istanbul ignore next */
                                    throw err;
                                }
                            }

                            for (var k = 0; k < replacements_keys.length; ++k) {
                                var r = replacements[replacements_keys[k]];
                                str = this.replaceAll(str, r, this.shortCode(replacements_keys[k]));
                            }

                            // Deduplicate within this file and with previous files.
                            var long = this.findDuplicates(str, outDir, files, i, options, skipFiles, wrapped);

                            if (long.length > 0) {
                                // Apply the deduplication replacements.
                                str = this.applyReplacements(str, long, numFiles, files, i, startPath, outDir, varName, wrapped, replacements, options, bar);
                            }

                        }
                        else {
                            bar.tick(i + 1);
                        }
                    }
                    else {
                        bar.tick(i + 1);
                    }

                    // Write the current text file.
                    mkdirp.sync(path.dirname(outDir + files[i]));
                    fs.writeFileSync(outDir + files[i], this.fixCodes(str));
                }

            }

        }

        // Output the PHP vfile.
        var vfile = '<?php ';
        try {
            replacements_keys = fs.readdirSync(replacements_dir);
        }
        catch (err) {
            if (err.code !== 'ENOENT') {
                /* istanbul ignore next */
                throw err;
            }
        }
        if (replacements_keys.length > 0) {
            for (var k = 0; k < replacements_keys.length; ++k) {
                var r = replacements[replacements_keys[k]];
                vfile += this.varCode(replacements_keys[k]) + '=\'' + this.addSlashes(r) + '\';';
            }
            fs.writeFileSync(outDir + options.vfile, this.fixCodes(vfile));
        }

        // Saved one tick for the end so as not to be misleading with 100% after all files are processed.
        bar.tick(1);
    },

    // Apply replacements.
    applyReplacements: function (str, long, numFiles, files, currentFileIndex, startPath, outDir, varName, wrapped, replacements, options, bar) {
        if (!wrapped[this.base64Enc(files[currentFileIndex])]) {
            // Add wrap to current file.
            str = this.prepend(options.vfile, (files[currentFileIndex].match(/\//g) || []).length) + this.addSlashes(str) + this.append();
            wrapped[this.base64Enc(files[currentFileIndex])] = true;
        }

        for (var j = 0; j < long.length; ++j) {

            // Use a function as a last chance to reject this match.
            if (this.replacementAllowed(long[j], varName[0], options)) {
                // Store the replacement.
                replacements[varName[0]] = long[j].str;

                var temp = str;
                // Make the replacement in the current file.
                str = this.replaceAll(str, long[j].str, this.shortCode(varName[0]));

                bar.tick(1);

                // Make the replacement in the other files.
                for (var k in long[j].occ) {
                    if (k != currentFileIndex && long[j].occ.hasOwnProperty(k)) {
                        var str2 = fs.readFileSync(outDir + files[k], 'utf8');

                        if (!wrapped[this.base64Enc(files[k])]) {
                            // Add wrap to file if it wasn't there.
                            str2 = this.prepend(options.vfile, (files[k].match(/\//g) || []).length) + this.addSlashes(str2) + this.append();
                            wrapped[this.base64Enc(files[k])] = true;
                        }
                        str2 = this.replaceAll(str2, long[j].str, this.shortCode(varName[0]));
                        fs.writeFileSync(outDir + files[k], this.fixCodes(str2));
                    }
                    bar.tick(1);
                }

                // varName has been spent, so update to another one.
                varName[0] = this.nextVarName(varName[0]);

            }

            // Update the progress bar to tick past the 'other' files that weren't iterated here.
            var remainder = j - long[j].occ.length - 1;
            if (remainder > 0) {
                bar.tick(remainder);
            }

        }
        return str;
    },

    /**
     * Determines whether to allow the current duplicate to be replaced in files.
     *
     * @param duplicate Object containing information about the deduplication match.
     * @param varName The name of the var that will be used in the replacement ('.${varName}.').
     * @param options The options object.
     * @returns {boolean}
     */
    replacementAllowed: function(duplicate, varName, options) {
        return duplicate.str.length - 5 - varName.length >= options.dedupe.minSaving;
    },

    // Clean up a string with replacements in it.
    fixCodes: function (str) {
        str = this.replaceAll(str, ".''", '');
        str = this.replaceAll(str, "''.", '');
        return str;
    },

    // Replace all occurrences of a substring.
    replaceAll: function (str, find, replace) {
        return str.replace(new RegExp(this.escapeRegExp(find), 'g'), replace);
    },

    // For use with replaceAll().
    escapeRegExp: function (str) {
        return str.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, "\\$1");
    },

    // Build the replacement string.
    shortCode: function (varName) {
        return "'." + this.varCode(varName) + ".'";
    },

    // Creates a variable string from a variable name.
    varCode: function (varName) {
        return '$' + varName;
    },

    // Build the prepend string to place at the top of each file.
    prepend: function (vfile, up) {
        for (var i = 0; i < up; ++i) {
            vfile = '../' + vfile;
        }
        return '<?php include \'' + vfile + '\';echo \'';
    },

    addSlashes: function (str) {
        return (str + '').replace(/'/g, "\'").replace(/\\/g, '\\');
    },

    append: function () {
        return "';";
    },

    // Get common start of an array of paths.
    startPath: function (strings) {
        // Sorts the strings and compares common starting substring of first and last string.
        var paths = strings.concat().sort(), j = 0, pathShort = paths[j], pathLong = paths[paths.length - 1], i = 0;
        // Skip one-level dirs at beginning of array.
        while (pathShort.indexOf('.') == -1 && pathShort.indexOf('/') == -1) pathShort = paths[++j];
        var pathShortLength = pathShort.length;
        while (i < pathShortLength && pathShort.charAt(i) === pathLong.charAt(i)) i++;
        var sharedStart = pathShort.substring(0, i);
        // Omit chars after the final forward-slash.
        if (sharedStart.indexOf("/") > -1) sharedStart = sharedStart.substr(0, 1 + sharedStart.lastIndexOf("/"));
        return sharedStart;
    },

    // Get the output directory path.
    outDir: function (startPath, inplace, output, fullnest) {
        var out = inplace ? startPath : output.replace(/\/?$/, '/') + (fullnest ? startPath : "");
        // Return with trailing slash.
        return out.replace(/\/?$/, '/');
    },

    // Find duplicates function.
    findDuplicates: function (str, outDir, files, currentFileIndex, options, skipFiles, wrapped) {
        var long = [];
        var opts = options.dedupe;
        var re = new RegExp("(["
            + opts.startsWith.join('')
            + "]?[^" + opts.startsWith.join('')
            + "" + opts.endsWith.join('') + "]*["
            + opts.endsWith.join('')
            + "]?){1}", "g");

        var a = this.unwrap(str, files, currentFileIndex, options, wrapped).split(re).filter(Boolean);

        for (var i = currentFileIndex; i >= 0; --i) {
            if (!skipFiles[i]) {
                var b;
                if (i == currentFileIndex) {
                    b = a;
                }
                else {
                    var str2 = fs.readFileSync(outDir + files[i], 'utf8');
                    b = str2.split(re).filter(Boolean);
                }
                this.fragments(long, a, b, currentFileIndex, i, opts.minLength);
            }
        }

        return long;
    },

    unwrap: function(str, files, fileIndex, options, wrapped) {
        if (wrapped[this.base64Enc(files[fileIndex])]) {
            var prepend = this.prepend(options.vfile, (files[fileIndex].match(/\//g) || []).length);
            var append = this.append();
            str = str.slice(prepend.length, -append.length);
        }

        return str;
    },

    /**
     * Searches for common consecutive items in two arrays of strings.
     *
     * If a_name and b_name are the same it will be aware that it is matching within the same piece of data.
     *
     * @param {object} long the object in which to add results, passed in so it can be reused.
     * @param {array} a an array of strings.
     * @param {array} b an array of strings.
     * @param {int|string} a_name name of array a, usually an integer.
     * @param {int|string} b_name name of array b, usually an integer.
     * @param {int} min the minimum size of a string to be considered.
     */
    fragments: function (long, a, b, a_name, b_name, min) {
        var a_length = a.length;
        for (var i = 0; i < a_length; ++i) {
            var b_length = b.length;
            for (var j = 0; j < b_length; ++j) {
                if ((a_name != b_name || i != j) && a[i] === b[j]) {
                    var str = a[i];
                    var k = 1;
                    while (i + k < a_length && j + k < b_length && a[i + k] === b[j + k]) {
                        str += a[i + k];
                        ++k;
                    }
                    if (str.length >= min) {
                        var existing = this.findWithAttr(long, 'str', str);
                        if (existing > -1) {
                            if (long[existing].occ[a_name]) {
                                if (long[existing].occ[a_name].indexOf(i) == -1) {
                                    long[existing].occ[a_name].push(i);
                                }
                            }
                            else {
                                long[existing].occ[a_name] = [i];
                            }
                            if (long[existing].occ[b_name]) {
                                if (long[existing].occ[b_name].indexOf(i) == -1) {
                                    long[existing].occ[b_name].push(i);
                                }
                            }
                            else {
                                long[existing].occ[b_name] = [i];
                            }
                        }
                        else if (a_name != b_name) {
                            long.push({
                                'str': str,
                                'len': str.length,
                                'alen': k,
                                'occ': {[a_name]: [i], [b_name]: [j]}
                            });
                        }
                        else {
                            long.push({
                                'str': str,
                                'len': str.length,
                                'alen': k,
                                'occ': {[a_name]: [i, j]}
                            });

                        }
                        // Wind i and j forward so we don't just match the suffix of the previous match.
                        i += k - 1;
                        j += k - 1;
                    }
                }
            }
        }
    },

    // Increments a PHP compatible variable name.  Input should start with an alpha char.
    nextVarName: function (str) {
        // Position of char to change.
        var change = str.length - 1;
        // The value of that char.
        var change_char = str[change];
        // Number of zeros to append when flipping.
        var zeros = 0;
        // Iterate backwards while there's a z (flipping).
        while (change_char == 'z') {
            // Increase the length of appended zeros
            zeros++;
            // Move the char to change back.
            change_char = str[--change];
        }
        if (change_char == undefined) {
            // Full flip - string increases in length.
            str = 'a' + Array(str.length + 1).join("0");
        }
        else {
            // Normal increment with partial flip and 9->a handling.
            str = str.substr(0, change)
                + (change_char == '9' ? 'a' : String.fromCharCode(str.charCodeAt(change) + 1))
                + Array(zeros + 1).join('0');
        }
        return str;
    },

    // Find the index in an array of objects by the value of an object's property.
    findWithAttr: function (array, attr, value) {
        for (var i = 0; i < array.length; i += 1) {
            if (array[i][attr] === value) {
                return i;
            }
        }
        return -1;
    },

    // Encode a string to base64.
    base64Enc: function (str) {
        var buffer = new Buffer(str);
        return buffer.toString('base64');
    },

    // Minify function.
    minify: function (input, options) {
        return minify(input, options.minify);
    }

};

// @todo Pull down remote websites to archive.
// @todo Rename files (and links to those files) based on title tag.
// @todo Option to serve files through an index.php instead of accessing directly.
// @todo Extract contents of style and script tags into separate files.
// @todo Analyze all files first to find all matching strings, when there are overlaps keep only longest.  Slow but better result.
