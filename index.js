#!/usr/bin/env node
'use strict';

var fs = require('fs-extra');
var globby = require('globby');
var minify = require('html-minifier').minify;
var mkdirp = require('mkdirp');
var mergeOptions = require('merge-options');
var isBinaryFile = require("isbinaryfile");
var path = require('path');
var readline = require('readline');
var jsonfile = require('jsonfile');

var webarchiver = {};
(function () {
    module.exports = webarchiver = {

        /**node
         * The main webarchiver function.
         * @param {object} options - The options object.
         */
        webArchiver: function (options) {
            // Check that there are options.
            if (options == null) throw new Error("No options given.");
            // Check that there is an input pattern.
            if (options.files == null) throw new Error("No input files defined in options.");
            // Check output options make sense.
            if (!options.inPlace && !options.output) throw new Error("You must set either 'output' or 'inplace'.");

            // Create option defaults and merge in the supplied options.
            this.createOptions(options);

            // Grab the files.
            this.inPaths = globby.sync(this.options.files);
            if (this.inPaths === undefined || this.inPaths.length == 0) {
                throw new Error("No input files found.");
            }

            // "Just copy" file list.
            this.justCopy = options.justCopy ? globby.sync(options.justCopy) : [];

            // Number of files.
            this.numFiles = this.inPaths.length;

            // Get the common prefix directories of all the files.
            this.startPath = this.getStartPath(this.inPaths);
            this.startPathLength = this.startPath.length;

            // Where to output the files.
            this.outDir = this.getOutDir();

            // Create tracking for altered filenames so they don't get reused.
            if (this.options.slugify) {
                this.slugMap = {};
            }

            // The first variable name to use.
            this.varName = 'a';

            // Tracking data.
            this.batchCreate('files');
            this.batchCreate('matches');
            this.stage = 1;

            // Process the files.
            this.processFiles();

            // Output the files.
            this.createOutFiles();

            // Write the PHP vfile.
            this.createVarFile();

            // Write the app state.
            if (this.options.writeState) {
                var out = {};
                for (var x in this) {
                    if (this.hasOwnProperty(x) && typeof(this[x]) != 'function' && x != 'bar') {
                        out[x] = this[x];
                    }
                }
                jsonfile.writeFileSync(this.outDir + 'state.json', out);
            }
            else {
                this.batchPurgeAll();
            }

            this.progress("Finished\n");

        },

        // Create the default options object and merge in the param values.
        createOptions: function (options) {
            var defaults = {
                vFile: 'v.php',
                passes: 2,
                skipContaining: ['<?'],
                minify: {
                    collapseBooleanAttributes: true,
                    collapseInlineTagWhitespace: true,
                    collapseWhitespace: true,
                    conservativeCollapse: false,
                    html5: false,
                    includeAutoGeneratedTags: false,
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
                    minLength: 20,
                    minSaving: 10,
                    startsWith: ['<', '{', '\\(', '\\['],
                    endsWith: ['>', '}', '\\)', '\\]', '\\n', '\\s'],
                    maxFileCompare: 1000
                },
                batchDir: 'wabatch',
                batchSize: 500
            };
            this.options = mergeOptions(defaults, options);
        },

        // Create tracking object for a file.
        createFileTrack: function (fileKey) {
            var isDir = fs.lstatSync(this.inPaths[fileKey]).isDirectory();
            var isBin = false;
            if (!isDir) {
                isBin = isBinaryFile.sync(this.inPaths[fileKey]);
            }
            var file = {
                path: this.inPaths[fileKey].substr(this.startPathLength),
                skip: this.justCopy.indexOf(this.inPaths[fileKey]) > -1,
                type: isDir ? 'dir' : (isBin ? 'bin' : 'text')
            };
            if (isDir || isBin) {
                // So it isn't used as an 'other' file in dedupes and fs.lstatSync isn't run on the 2nd pass.
                file.skip = true;
            }
            // Output path.
            file.outPath = this.outDir + file.path;
            this.batchInsert('files', fileKey, file);
            return file;
        },

        // Determine additional skip conditions based on the contents of the file.
        determineTextFileSkip: function (file, fileKey, str) {
            if (!file.skip) {
                for (var j = 0; j < this.options.skipContaining.length; ++j) {
                    if (str.indexOf(this.options.skipContaining[j]) > -1) {
                        file.skip = true;
                        this.batchUpdate('files', fileKey, file);
                        break;
                    }
                }
            }
        },

        // File processing function.
        processFiles: function () {
            var ctx = this;

            // Work out the slugify stuff, if applicable.
            if (this.options.slugify) {
                for (var fileKey = 0; fileKey < this.numFiles; ++fileKey) {
                    var file = this.createFileTrack(fileKey);
                    this.progress(this.stage + ') Slugifying file ' + (fileKey + 1) + ' of ' + this.numFiles + ' (' + file.path + ')');
                    if (!file.skip) {
                        var str = fs.readFileSync(this.inPaths[fileKey], 'utf8');
                        // Work out slugs.
                        this.slugify(file, fileKey, str);
                        if (this.options.inPlace) {
                            // Rename.
                            fs.renameSync(file.path, file.outPath);
                        }
                    }
                }
                this.stage++;
            }
            for (var pass = 0; pass < this.options.passes; ++pass) {
                for (var fileKey = 0; fileKey < this.numFiles; ++fileKey) {
                    var file;
                    if (pass == 0 && !this.options.slugify) {
                        file = this.createFileTrack(fileKey);
                    }
                    else {
                        file = this.batchRead('files', fileKey);
                    }

                    this.progress(this.stage + ') Processing file ' + (fileKey + 1) + ' of ' + this.numFiles + ', pass '
                        + (pass + 1) + ' of ' + this.options.passes + ' (' + file.path + ')');

                    if (file.type == 'text') {
                        // Process text files.
                        var str;
                        if (pass == 0) {
                            // Read the file contents.
                            str = fs.readFileSync(this.inPaths[fileKey], 'utf8');
                            // Determine additional skip conditions based on the contents of the file.
                            this.determineTextFileSkip(file, fileKey, str);
                        }

                        // Ensure it's not a file to skip.
                        if (!file.skip) {
                            if (pass == 0) {
                                // String manipulations.
                                str = this.manipulations(fileKey, str);
                            }

                            if (this.options.dedupe !== false) {
                                if (pass == 0) {
                                    // Fragment the file for use in deduplication.
                                    file.frags = this.createFragments(this.addSlashes(str), this.options.dedupe);
                                }

                                // Apply existing replacements.
                                var matchesGen = this.batchIterator('matches');
                                var gen = matchesGen.next().value;
                                while (gen !== undefined) {
                                    var match = gen.value;
                                    this.matchReplace(match, gen.key, function() {
                                        file.frags = ctx.doReplace(file.frags, match, file, fileKey);
                                    });
                                    gen = matchesGen.next().value;
                                }

                                // Find duplicates.
                                var new_matches = this.findDuplicates(file, fileKey);
                                this.processNewMatches(new_matches);

                            }
                            else if (pass == 0) {
                                // Immediate write for non-deduplicated text files.
                                mkdirp.sync(path.dirname(file.outPath));
                                fs.writeFileSync(file.outPath, str);
                                file.saved = true;
                            }

                            this.batchUpdate('files', fileKey, file);
                        }
                    }
                }
            }
            this.stage++;
        },

        // Act on new matches.
        processNewMatches: function (new_matches) {
            var ctx = this;
            for (var m = 0; m < new_matches.length; ++m) {
                var match = this.batchRead('matches', new_matches[m]);
                this.setOccTotal(match);
                match.allowed = this.replacementAllowed(match);
                match.reps = match.reps ? match.reps : 0;
                this.matchReplace(match, new_matches[m], function() {
                    // Make the replacements.
                    for (var fileKey in match.occ) {
                        var file = ctx.batchRead('files', fileKey);
                        if (match.occ.hasOwnProperty(fileKey)) {
                            file.frags = ctx.doReplace(file.frags, match, file, fileKey);
                        }
                        ctx.batchUpdate('files', fileKey, file);
                    }
                });
            }
        },

        // Match replacements.
        matchReplace: function (match, matchKey, replaceCallback) {
            if (match.allowed) {
                var varTaken = false;
                if (!match.var) {
                    match.var = this.varName;
                    varTaken = true;
                }
                var repsOld = match.reps;

                replaceCallback();

                if (match.reps) {
                    if (varTaken) {
                        // varName has been spent, so update to another one.
                        this.varName = this.nextVarName(this.varName);
                    }
                    if (match.reps != repsOld) {
                        this.batchUpdate('matches', matchKey, match);
                    }
                }
                else {
                    match.var = null;
                }

            }
        },

        // Show progress.
        progress: function (out) {
            if (!this.options.noProgress) {
                readline.clearLine(process.stdout, 0);
                readline.cursorTo(process.stdout, 0);
                process.stdout.write(out);
            }
        },

        // Write the files.
        createOutFiles: function () {
            for (var fileKey = 0; fileKey < this.numFiles; ++fileKey) {
                var file = this.batchRead('files', fileKey);
                this.progress(this.stage + ') Writing file ' + (fileKey + 1) + ' of ' + this.numFiles + ' (' + file.path + ')');
                mkdirp.sync(path.dirname(file.outPath));
                // Write deduplicated text files.
                if (file.deduped) {
                    fs.writeFileSync(
                        file.outPath,
                        this.fixCodes(
                            this.prepend(this.options.vFile, (file.path.match(/\//g) || []).length)
                            + file.frags.join('')
                            + this.append()
                        )
                    );
                }
                // Write directories.
                else if (file.type == 'dir') {
                    mkdirp.sync(file.outPath);
                }
                // Write binaries.
                else if (file.type == 'bin') {
                    // Copy the file over.
                    fs.writeFileSync(file.outPath, fs.readFileSync(this.inPaths[fileKey], 'binary'), 'binary');
                }
                // Write non-deduplicated text files that haven't already been saved.
                else if (file.type == 'text' && !file.saved) {
                    fs.writeFileSync(file.outPath, fs.readFileSync(this.inPaths[fileKey], 'utf8'));
                }
            }
            this.stage++;
        },

        // Write the PHP variables file.
        createVarFile: function () {
            this.progress(this.stage + ') Writing variables file');
            var vFile = '<?php ';

            var matchesGen = this.batchIterator('matches');
            var gen = matchesGen.next().value;
            while (gen !== undefined) {
                var match = gen.value;
                if (match.reps) {
                    vFile += this.varCode(match.var) + '=\'' + match.str + '\';';
                }
                gen = matchesGen.next().value;
            }

            mkdirp.sync(path.dirname(this.outDir));
            fs.writeFileSync(this.outDir + this.options.vFile, this.fixCodes(vFile));
        },

        /**
         * Determines whether to allow the current duplicate to be replaced in files.
         *
         * The implementation of this function should remain ignorant of which string/file the replacement is being applied
         * to as its result is reused for other files without calling this function again.
         *
         * @param match {object} Object containing information about the deduplication match.
         * @returns {boolean}
         */
        replacementAllowed: function (match) {
            return (!this.options.dedupe.minOcc || match.occTotal >= this.options.dedupe.minOcc) && match.str.length >= this.autoMinLength();
        },

        // Work out the total occurrences of a match.
        setOccTotal: function (match) {
            var occurrences = 0;
            for (var i in match.occ) {
                if (match.occ.hasOwnProperty(i)) {
                    occurrences += match.occ[i].length;
                }
            }
            match.occTotal = occurrences;
        },

        // Generates an automatic value for minLength based on minSaving and the length of the current shortCode.
        autoMinLength: function () {
            return this.options.dedupe.minSaving + this.shortCode(this.varName).length;
        },

        // Perform the replacement.
        doReplace: function (frags, match, file, fileKey) {
            var seek, offset;
            for (var frag = 0; frag < frags.length; ++frag) {
                if (match.str.indexOf(frags[frag]) === 0) {
                    // This could be it.
                    seek = frag + 1;
                    offset = frags[frag].length;
                    while (seek < frags.length && offset < match.str.length && match.str.substring(offset, offset + frags[seek].length) === frags[seek]) {
                        offset += frags[seek].length;
                        seek++;
                    }
                    if (offset >= match.str.length) {
                        // This is it.  Make the replacement and clear out the extra elements.
                        frags[frag] = this.shortCode(match.var);
                        for (var i = frag + 1; i < seek; ++i) {
                            frags[i] = '';
                        }
                        // Mark this file as deduped.
                        file.deduped = true;

                        // Count replacements.
                        match.reps++;

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
        prepend: function (vFile, up) {
            for (var i = 0; i < up; ++i) {
                vFile = '../' + vFile;
            }
            return '<?php include \'' + vFile + '\';echo \'';
        },

        // Adds slashes to the contents of a file to make it compatible with deduplication.
        addSlashes: function (str) {
            return (str + '').replace(/\\/g, '\\').replace(/'/g, "\\'");
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
            var out = this.options.inPlace ? this.startPath : this.options.output.replace(/\/?$/, '/') + (this.options.fullNest ? this.startPath : "");
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
        findDuplicates: function (file, fileKey) {
            var a = file.frags;
            var minLen = this.options.dedupe.minLength ? this.options.dedupe.minLength : this.autoMinLength();
            var compared = 0;
            var new_matches = [];
            for (var fileKey2 = fileKey; fileKey2 >= 0; --fileKey2) {
                var file2 = fileKey == fileKey2 ? file : this.batchRead('files', fileKey2);
                if (!file2.skip) {
                    var b = file2.frags;
                    this.fragmentMatches(new_matches, a, b, fileKey, fileKey2, minLen);
                    compared++;
                    if (this.options.dedupe.maxFileCompare && compared > this.options.dedupe.maxFileCompare) {
                        break;
                    }
                }
            }
            return new_matches;
        },

        /**
         * Searches for common consecutive items in two arrays of strings.
         *
         * If a_name and b_name are the same it will be aware that it is matching within the same piece of data.
         *
         * @param {array} new_matches an array to store the keys of new matches.
         * @param {array} a an array of strings.
         * @param {array} b an array of strings.
         * @param {int|string} a_name name of array a, usually an integer.
         * @param {int|string} b_name name of array b, usually an integer.
         * @param {int} min the minimum size of a string to be considered.
         */
        fragmentMatches: function (new_matches, a, b, a_name, b_name, min) {
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
                            this.addMatch(new_matches, a_name, i, b_name, j, str);

                            // Wind i and j forward so we don't just match the suffix of the previous match.
                            i += k - 1;
                            j += k - 1;
                        }
                    }
                }
            }
        },

        // Merge a match into an object of matches.
        addMatch: function (new_matches, a_name, a_pos, b_name, b_pos, str) {
            var matchResult = this.batchRead('matches', str, 'str');
            var matchKey;
            if (matchResult !== undefined) {
                var match = matchResult.value;
                var matchKey = matchResult.key;
                if (match.occ[a_name]) {
                    if (match.occ[a_name].indexOf(a_pos) == -1) {
                        match.occ[a_name].push(a_pos);
                    }
                }
                else {
                    match.occ[a_name] = [a_pos];
                }
                if (match.occ[b_name]) {
                    if (match.occ[b_name].indexOf(b_pos) == -1) {
                        match.occ[b_name].push(b_pos);
                    }
                }
                else {
                    match.occ[b_name] = [b_pos];
                }
                this.batchUpdate('matches', matchKey, match);
            }
            else if (a_name != b_name) {
                matchKey = this.batchInsert('matches', null, {
                    str: str,
                    occ: {[a_name]: [a_pos], [b_name]: [b_pos]}
                });
            }
            else {
                matchKey = this.batchInsert('matches', null, {
                    str: str,
                    occ: {[a_name]: [a_pos, b_pos]}
                });
            }
            new_matches.push(matchKey);
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

        // Minify function.
        minify: function (str) {
            try {
                return minify(str, this.options.minify);
            } catch (err) {
                return str;
            }
        },

        // Crude form element disabler.
        disable: function (str) {
            var find = [];
            var replace = [];
            for (var d = 0; d < this.options.disable.length; ++d) {
                find.push('<' + this.options.disable[d]);
                replace.push('<' + this.options.disable[d] + ' disabled');
            }
            return str.replace(new RegExp(find.join('|'), 'g'), function (tagOpen) {
                return replace[find.indexOf(tagOpen)];
            });
        },

        // Get the slugified title.
        slugifySlug: function (str) {
            var match = str.match(/<title[^>]*>([^<]+)<\/title>/);
            if (match) {
                var title = match[1];
                if (title != '') {
                    if (this.options.slugifyIgnore) {
                        title = title.replace(new RegExp(this.options.slugifyIgnore.join('|'), 'ig'), '');
                    }
                    if (title != '') {
                        return title.toLowerCase().trim().replace(/ /g, '-').replace(/[^\w-]+/g, '');
                    }
                }
            }
            return false;
        },

        // Alter the filename.
        slugify: function (file, fileKey, str) {
            file.originalPath = file.path;
            var fileExt = file.path.substr(file.path.lastIndexOf('.'));
            var basePath = file.path.substr(0, file.path.lastIndexOf('/') + 1);
            var slug = this.slugifySlug(str);
            if (slug !== false) {
                var disambiguate = 2;
                var changed_slug = slug + fileExt;
                while (changed_slug in this.slugMap) {
                    changed_slug = slug + '-' + disambiguate + fileExt;
                    disambiguate++;
                }
                slug = changed_slug;
                file.alteredPath = basePath + slug;
                file.outPath = this.outDir + file.alteredPath;
                this.slugMap[basePath + slug] = file.path;
            }
            this.batchUpdate('files', fileKey, file);
        },

        slugifyReplace: function (str) {
            for (var slug in this.slugMap) {
                str = this.replaceAll(str, this.slugMap[slug], slug);
            }
            return str;
        },

        // Custom string manipulation.
        manipulations: function (fileKey, str) {
            // Minify the file contents.
            if (this.options.minify) {
                str = this.minify(str);
            }

            // Search and replace.
            if (this.options.searchReplace) {
                var a = this.options.searchReplace.search;
                var b = this.options.searchReplace.replace;
                var i = this.options.searchReplace.i ? 'i' : '';
                str = str.replace(new RegExp(a.map(function (x) {
                    return x.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
                }).join('|'), 'g' + i), function (c) {
                    return b[a.indexOf(c)];
                });
            }

            // Disable form elements.
            if (this.options.disable) {
                str = this.disable(str);
            }

            // Alter references to altered filenames.
            if (this.options.slugify) {
                str = this.slugifyReplace(str);
            }

            return str;
        },

        // Create batch set.
        batchCreate: function (name) {
            if (this.batch == undefined) {
                this.batch = {};
            }
            this.batch[name] = {
                batches: 1,
                current: 0,
                totalLen: 0,
                lastLen: 0,
                data: {}
            };
        },

        // Batch read.
        // 'search' is key unless prop supplied, then it's a prop value.
        // If prop supplied will return an object with key and value, rather than just the value.
        batchRead: function (name, search, prop) {
            var start = this.batch[name].current;
            var cur = start;
            var value = prop ? this.batchFilter(name, prop, search) : this.batch[name].data[search];
            if (value === undefined && this.batch[name].batches > 1) {
                this.batchSaveCurrent(name);
            }
            while (value === undefined) {
                cur++;
                if (cur >= this.batch[name].batches) {
                    cur = 0;
                }
                if (cur == start) {
                    cur--;
                    break;
                }
                this.batchLoad(name, cur);
                value = prop ? this.batchFilter(name, prop, search) : this.batch[name].data[search];
            }
            return value;
        },

        // Helper function for batchRead() when using a prop.
        batchFilter: function (name, prop, value) {
            var result = {}, key;
            for (key in this.batch[name].data) {
                if (this.batch[name].data.hasOwnProperty(key) && this.batch[name].data[key][prop] == value) {
                    result.key = key;
                    result.value = this.batch[name].data[key];
                    return result;
                }
            }
            return undefined;
        },

        // Helper function to save the current batch.
        batchSaveCurrent: function (name) {
            mkdirp.sync(this.outDir + this.options.batchDir);
            jsonfile.writeFileSync(this.outDir + this.options.batchDir + '/' + name + '.' + this.batch[name].current + '.json', this.batch[name].data);
        },

        // Helper function to load batches.
        batchLoad: function (name, batch) {
            if (batch == 'last') {
                batch = this.batch[name].batches - 1;
            }
            if (this.batch[name].current != batch) {
                this.batch[name].data = jsonfile.readFileSync(this.outDir + this.options.batchDir + '/' + name + '.' + batch + '.json');
                this.batch[name].current = batch;
            }
        },

        // Batch insert.
        batchInsert: function (name, key, value) {
            if (key === null) {
                key = this.batch[name].totalLen;
            }
            if (this.batch[name].lastLen >= this.options.batchSize) {
                // Create a new batch.
                this.batchSaveCurrent(name);
                this.batch[name].data = {};
                this.batch[name].data[key] = value;
                this.batch[name].lastLen = 1;
                this.batch[name].totalLen++;
                this.batch[name].batches++;
                this.batch[name].current = this.batch[name].batches - 1;
            }
            else {
                if (this.batch[name].current != this.batch[name].batches - 1) {
                    // Load the last batch.
                    this.batchSaveCurrent(name);
                    this.batchLoad(name, 'last');
                }
                this.batch[name].data[key] = value;
                this.batch[name].lastLen++;
                this.batch[name].totalLen++;
            }
            return key;
        },

        // Update a batch value by key, falls back to an insert.
        batchUpdate: function (name, key, value) {
            var value = this.batchRead(name, key);
            if (value !== undefined) {
                this.batch[name].data[key] = value;
            }
            else {
                this.batchInsert(name, key, value);
            }
        },

        batchIterator: function* (name) {
            if (this.batch[name].batches > 1) {
                this.batchSaveCurrent(name);
            }
            for (var b = 0; b < this.batch[name].batches; ++b) {
                this.batchLoad(name, b);
                for (var key in this.batch[name].data) {
                    if (this.batch[name].data.hasOwnProperty(key)) {
                        yield { key: key, value: this.batch[name].data[key] };
                    }
                }
            }
        },

        // Delete all batch data.
        batchPurgeAll: function () {
            fs.remove(this.outDir + this.options.batchDir);
        }

    };

    // This is for command line usage.
    /* istanbul ignore next */
    if (!module.parent) {
        // Grab command line args.
        var commandLineArgs = require('command-line-args');
        var optionDefinitions = [
            {name: 'files', type: String, multiple: true},
            {name: 'justCopy', type: String, multiple: true},
            {name: 'inPlace', type: Boolean},
            {name: 'output', type: String},
            {name: 'dedupe', type: Boolean},
            {name: 'dedupe.minLength', type: Number},
            {name: 'dedupe.minSaving', type: Number},
            {name: 'dedupe.startsWith', type: String, multiple: true},
            {name: 'dedupe.endsWith', type: String, multiple: true},
            {name: 'minify', type: Boolean},
            {name: 'vFile', type: String},
            {name: 'fullNest', type: Boolean},
            {name: 'skipContaining', type: String, multiple: true},
            {name: 'noProgress', type: Boolean},
            {name: 'passes', type: Number},
            {name: 'disable', type: String, multiple: true},
            {name: 'slugify', type: Boolean},
            {name: 'slugifyIgnore', type: String, multiple: true},
            {name: 'writeState', type: Boolean},
            {name: 'batchDir', type: String},
            {name: 'batchSize', type: Number}
        ];
        var options = commandLineArgs(optionDefinitions, {partial: true});

        // minify.* options will be in '_unknown', so move them out of there.
        if (options['_unknown']) {
            for (var u = 0; u < options['_unknown'].length - 1; u += 2) {
                options[(options['_unknown'][u]).replace('--', '')] = options['_unknown'][u + 1];
            }
            delete options['_unknown'];
        }

        // Nest dedupe.* and minify.* options correctly.
        for (var o in options) {
            if (options.hasOwnProperty(o)) {
                if (o.indexOf("dedupe.") === 0) {
                    var key = o.substring(7);
                    if (options.dedupe === undefined) options.dedupe = {};
                    options.dedupe[key] = options[o];
                    delete options[o];
                }
                else if (o.indexOf("minify.") === 0) {
                    var key = o.substring(7);
                    if (options.minify === undefined) options.minify = {};
                    if (options[o] == 'true') options[o] = true;
                    if (options[o] == 'false') options[o] = false;
                    options.minify[key] = options[o];
                    delete options[o];
                }
            }
        }

        // Execute the app.
        webarchiver.webArchiver(options);
    }
})();
