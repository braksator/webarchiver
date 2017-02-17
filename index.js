'use strict';

var fs = require('fs');
var globby = require('globby');
var minify = require('html-minifier').minify;
var mkdirp = require('mkdirp');
var del = require('del');
var mergeOptions = require('merge-options');
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
     * @param {bool} options.fullnest - Whether to maintain full path nesting in the output directory - defaults to false.
     * @param {array} options.skipcontaining - An array of strings, if a text file contains any of them it will be 'just copied'. Default is ['<?'].
     * @param {bool} options.noprogress - Set to true to remove the progress bar.
     * @param {bool} options.passes - Number of deduplication passes over the files.  Defaults to 2.
     */
    webArchiver: function (options) {
        // Check that there are options.
        if (options == null) throw new Error("No options given.");
        // Check that there is an input pattern.
        if (options.files == null) throw new Error("No input files defined in options.");
        // Check output options make sense.
        if (!options.inplace && !options.output) throw new Error("You must set either 'output' or 'inplace'.");

        // Create option defaults and merge in the supplied options.
        this.createOptions(options);

        // Create the output directory (and any necessary subdirectories) if it doesn't exist (ignore the error if it already exists).
        //if (options.output) {
        //    mkdirp.sync(options.output);
        //}

        // Grab the files.
        if (typeof this.options.files == 'string') this.options.files = [this.options.files];
        this.options.files.push("!**/" + this.options.dbdir + "/**");
        this.options.files.push("!**/" + this.options.vfile);
        this.fileList = globby.sync(this.options.files);

        // Check that there are files.
        if (this.fileList === undefined || this.fileList.length == 0) {
            throw new Error("No input files found.");
        }

        // Just copy file list.
        this.justCopy = [];
        if (options.justcopy) {
            this.justCopy = globby.sync(options.justcopy);
        }

        // Number of files.
        this.numFiles = this.fileList.length;

        // Set up progress bar.
        this.progressBar();

        // Get the common prefix directories of all the files.
        this.startPath = this.getStartPath(this.fileList);
        this.startPathLength = this.startPath.length;

        // Where to output the files.
        this.outDir = this.getOutDir();

        // The first variable name to use.
        this.varName = 'a';

        // Tracking data.
        this.files = {};
        this.replacements = {};

        // Process the files.
        this.processFiles();

        // Output the files.
        this.createOutFiles();

        // Write the PHP vfile.
        this.createVarFile();

        // Saved one tick for the end.
        this.bar.tick(1, {'msg': 'Files processed, completing job...'});

    },

    createOptions: function (options) {
        var defaults = {
            vfile: 'v.php',
            passes: 2,
            skipcontaining: ['<?'],
            minify: {
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
            },
            dedupe: {
                minLength: 10,
                minSaving: 4,
                startsWith: ['<', '{', '\\(', '\\[', '"'],
                endsWith: ['>', '}', '\\)', '\\]', '"', '\\n', '\\s']
            }
        };
        this.options = mergeOptions(defaults, options);

        //// Setup minify options.
        //if (options.minify !== false) {
        //    var minify_opts = {
        //        collapseBooleanAttributes: true,
        //        collapseInlineTagWhitespace: true,
        //        collapseWhitespace: true,
        //        conservativeCollapse: false,
        //        html5: false,
        //        minifyCSS: true,
        //        minifyJS: true,
        //        removeAttributeQuotes: true,
        //        removeComments: true,
        //        removeEmptyAttributes: true,
        //        removeRedundantAttributes: true,
        //        removeScriptTypeAttributes: true,
        //        removeStyleLinkTypeAttributes: true
        //    };
        //    this.options.minify = mergeOptions(minify_opts, options);
        //}
        //
        //// Setup dedupe options.
        //if (options.dedupe !== false) {
        //    var dedupe_opts = ;
        //    this.options.dedupe = mergeOptions(dedupe_opts, options);
        //}
    },

    progressBar: function () {
        if (!this.options.noprogress) {
            this.bar = new ProgressBar('  Archiving [:bar] :percent :msg ETA: :eta sec', {
                width: 50,
                // This is a 1+2+3+4... formula multiplied by passes plus numFiles to write out the files plus one
                // extra tick for writing the vfile.
                total: ((this.numFiles * (this.numFiles + 1)) / 2) * this.options.passes + this.numFiles + 1
            });
        }
        else {
            // Dummy.
            this.bar = {
                tick: function () {
                }
            };
        }
    },

    // File processing function.
    processFiles: function () {
        for (var pass = 0; pass < this.options.passes; ++pass) {
            for (var fileKey = 0; fileKey < this.numFiles; ++fileKey) {
                if (pass == 0) {
                    // Create tracking object for this file.
                    this.files[fileKey] = {
                        inPath: this.fileList[fileKey],
                        path: this.fileList[fileKey].substr(this.startPathLength)
                    };
                    // Determine if this file shouldn't be processed.
                    this.files[fileKey].skip = this.justCopy.indexOf(this.files[fileKey].inPath) > -1;
                    // Output path.
                    this.files[fileKey].outPath = this.outDir + this.files[fileKey].path;
                }

                if (!this.files[fileKey].skip && fs.lstatSync(this.files[fileKey].inPath).isDirectory()) {
                    // Directory.

                    // So it isn't used as an 'other' file in dedupes and fs.lstatSync isn't run on the 2nd pass.
                    this.files[fileKey].skip = true;
                }
                else if (!this.files[fileKey].skip && isBinaryFile.sync(this.files[fileKey].inPath)) {
                    // Process binary files.
                    // Ensure the output dir exists.
                    mkdirp.sync(path.dirname(this.files[fileKey].outPath));

                    if (this.files[fileKey].inPath != this.files[fileKey].outPath) {
                        // Copy the file over.
                        var file = fs.readFileSync(this.files[fileKey].inPath, 'binary');
                        fs.writeFileSync(this.files[fileKey].outPath, file, 'binary');
                    }
                    // So it isn't used as an 'other' file in dedupes and isBinaryFile isn't run on the 2nd pass.
                    this.files[fileKey].skip = true;
                }
                else {
                    // Process text files.
                    var str;
                    if (pass == 0) {
                        // Read the file contents.
                        str = fs.readFileSync(this.files[fileKey].inPath, 'utf8');

                        // Determine additional skip conditions based on the contents of the file.
                        if (!this.files[fileKey].skip) {
                            for (var j = 0; j < this.options.skipcontaining.length; ++j) {
                                if (str.indexOf(this.options.skipcontaining[j]) > -1) {
                                    this.files[fileKey].skip = true;
                                    break;
                                }
                            }
                        }
                    }

                    // Ensure it's not a file to skip.
                    if (!this.files[fileKey].skip) {
                        // Minify the file contents.
                        if (pass == 0 && this.options.minify !== false) {
                            str = this.minify(str);
                        }

                        if (this.options.dedupe !== false) {
                            if (pass == 0) {
                                // Fragment the file for use in deduplication.
                                this.files[fileKey].frags = this.createFragments(this.addSlashes(str), this.options.dedupe);
                            }

                            // Apply existing replacements.
                            for (var varName in this.replacements) {
                                if (this.replacements.hasOwnProperty(varName)) {
                                    // No need to call replacementAllowed here because if it wasn't allowed it wasn't stored.
                                    this.files[fileKey].frags = this.doReplace(this.files[fileKey].frags, this.replacements[varName], varName, fileKey);
                                }
                            }

                            // Deduplicate within this file and with previous files.
                            var matches = this.findDuplicates(fileKey);
                            if (matches.length > 0) {
                                // Apply the deduplication replacements.
                                this.processMatches(matches);
                            }

                        }
                    }

                    // Write the current text file if it wasn't deduped.  It may get deduped later and will be overwritten.
                    if (pass == 0 && (!this.options.dedupe || !this.files[fileKey].deduped)) {
                        mkdirp.sync(path.dirname(this.files[fileKey].outPath));
                        fs.writeFileSync(this.files[fileKey].outPath, str);
                    }
                }

                this.bar.tick(fileKey + 1, {'msg': 'File ' + (fileKey + 1) + '/' + this.numFiles + ' (pass ' + (pass + 1) + '/' + this.options.passes + ')'});
            }

        }

    },

    // Write the deduplicated files.
    createOutFiles: function () {
        if (this.options.dedupe !== false) {
            for (var fileKey = 0; fileKey < this.numFiles; ++fileKey) {
                if (this.files[fileKey].deduped) {
                    mkdirp.sync(path.dirname(this.files[fileKey].outPath));
                    fs.writeFileSync(
                        this.files[fileKey].outPath,
                        this.fixCodes(
                            this.prepend(this.options.vfile, (this.files[fileKey].path.match(/\//g) || []).length)
                            + this.files[fileKey].frags.join('')
                            + this.append()
                        )
                    );
                }
                this.bar.tick(1, {'msg': 'Write ' + (fileKey + 1) + '/' + this.numFiles});
            }
        }
        else {
            this.bar.tick(this.numFiles, {'msg': 'Write ' + this.numFiles + '/' + this.numFiles});
        }
    },

    // Write the PHP variables file.
    createVarFile: function () {
        var vfile = '<?php ';
        for (var varName in this.replacements) {
            if (this.replacements.hasOwnProperty(varName)) {
                vfile += this.varCode(varName) + '=\'' + this.replacements[varName] + '\';';
            }
        }
        fs.writeFileSync(this.outDir + this.options.vfile, this.fixCodes(vfile));
    },

    // Act on new matches.
    processMatches: function (matches) {
        for (var match = 0; match < matches.length; ++match) {
            // Use a function as a last chance to reject this match.
            if (this.replacementAllowed(matches[match])) {
                // Store the replacement.
                this.replacements[this.varName] = matches[match].str;

                // Make the replacements.
                for (var fileKey in matches[match].occ) {
                    if (matches[match].occ.hasOwnProperty(fileKey)) {
                        this.files[fileKey].frags =
                            this.doReplace(this.files[fileKey].frags, matches[match].str, this.varName, fileKey);
                    }
                }

                // varName has been spent, so update to another one.
                this.varName = this.nextVarName(this.varName);
            }
        }
    },

    /**
     * Determines whether to allow the current duplicate to be replaced in files.
     *
     * The implementation of this function should remain ignorant of which string/file the replacement is being applied
     * to as its result is reused for other files without calling this function again.  Though it can consider
     * match.occ.length which gives the number of occurrences.
     *
     * @param match Object containing information about the deduplication match.
     * @returns {boolean}
     */
    replacementAllowed: function (match) {
        return match.str.length >= this.autoMinLength();
    },

    // Generates an automatic value for minLength based on minSaving and the length of the current shortCode.
    autoMinLength: function () {
        return this.options.dedupe.minSaving + this.shortCode(this.varName).length;
    },

    // Perform the replacement.
    doReplace: function (frags, match, varName, fileKey) {
        var seek, offset;
        for (var frag = 0; frag < frags.length; ++frag) {
            if (match.indexOf(frags[frag]) === 0) {
                // This could be it.
                seek = frag + 1;
                offset = frags[frag].length;
                while (seek < frags.length && offset < match.length && match.substring(offset, offset + frags[seek].length) === frags[seek]) {
                    offset += frags[seek].length;
                    seek++;
                }
                if (offset >= match.length) {
                    // This is it.  Make the replacement and clear out the extra elements.
                    frags[frag] = this.shortCode(varName);
                    for (var i = frag + 1; i < seek; ++i) {
                        frags[i] = '';
                    }
                    // Mark this file as deduped.
                    this.files[fileKey].deduped = true;

                    // Wind f forward.
                    frag = seek - 1;
                }
            }
        }
        // Remove the cleared elements as they will hinder stacked matches.
        return frags.filter(Boolean);
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

    // Build the prepend string to place at the start of each deduplicated file.
    prepend: function (vfile, up) {
        for (var i = 0; i < up; ++i) {
            vfile = '../' + vfile;
        }
        return '<?php include \'' + vfile + '\';echo \'';
    },

    // Adds slashes to the contents of a file to make it compatible with deduplication.
    addSlashes: function (str) {
        return (str + '').replace(/'/g, "\'").replace(/\\/g, '\\');
    },

    // Build the append string to place at the end of each deduplicated file.
    append: function () {
        return "';";
    },

    // Get common start of an array of paths.
    getStartPath: function (strings) {
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
    getOutDir: function () {
        var out = this.options.inplace ? this.startPath : this.options.output.replace(/\/?$/, '/') + (this.options.fullnest ? this.startPath : "");
        // Return with trailing slash.
        return out.replace(/\/?$/, '/');
    },

    // Fragment a file to prepare it for deduplication.
    createFragments: function (str) {
        var re = new RegExp("(["
            + this.options.dedupe.startsWith.join('')
            + "]?[^" + this.options.dedupe.startsWith.join('')
            + "" + this.options.dedupe.endsWith.join('') + "]*["
            + this.options.dedupe.endsWith.join('')
            + "]?){1}", "g");

        return str.split(re).filter(Boolean);
    },

    // Find duplicates function.
    findDuplicates: function (fileKey) {
        var matches = [];
        var a = this.files[fileKey].frags;
        var minLen = this.options.dedupe.minLength ? this.options.dedupe.minLength : this.autoMinLength();
        for (var fileKey2 = fileKey; fileKey2 >= 0; --fileKey2) {
            if (!this.files[fileKey2].skip) {
                var b = this.files[fileKey2].frags;
                this.fragmentMatches(matches, a, b, fileKey, fileKey2, minLen);
            }
        }
        return matches;
    },

    /**
     * Searches for common consecutive items in two arrays of strings.
     *
     * If a_name and b_name are the same it will be aware that it is matching within the same piece of data.
     *
     * @param {object} matches the object in which to add results, passed in so it can be reused.
     * @param {array} a an array of strings.
     * @param {array} b an array of strings.
     * @param {int|string} a_name name of array a, usually an integer.
     * @param {int|string} b_name name of array b, usually an integer.
     * @param {int} min the minimum size of a string to be considered.
     */
    fragmentMatches: function (matches, a, b, a_name, b_name, min) {
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
                        var existing = this.findWithAttr(matches, 'str', str);
                        if (existing > -1) {
                            if (matches[existing].occ[a_name]) {
                                if (matches[existing].occ[a_name].indexOf(i) == -1) {
                                    matches[existing].occ[a_name].push(i);
                                }
                            }
                            else {
                                matches[existing].occ[a_name] = [i];
                            }
                            if (matches[existing].occ[b_name]) {
                                if (matches[existing].occ[b_name].indexOf(i) == -1) {
                                    matches[existing].occ[b_name].push(i);
                                }
                            }
                            else {
                                matches[existing].occ[b_name] = [i];
                            }
                        }
                        else if (a_name != b_name) {
                            matches.push({
                                'str': str,
                                'occ': {[a_name]: [i], [b_name]: [j]}
                            });
                        }
                        else {
                            matches.push({
                                'str': str,
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

    // Minify function.
    minify: function (str) {
        return minify(str, this.options.minify);
    }

};
