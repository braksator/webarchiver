#!/usr/bin/env node

const del = require('del');
var fse = require('fs-extra');
var table = require('markdown-table');
var mergeOptions = require('merge-options');
var getSize = require('get-folder-size');


var outputSize = function (promises, times, lastItem, outDir) {
    promises.push(new Promise(function (resolve, reject) {
        getSize(outDir, function (err, size) {
            if (err) {
                return reject(err);
            }
            times[lastItem]['Output size'] = (size / 1024 / 1024).toFixed(2) + ' MB';
            resolve();
        });
    }));
};


(function () {
    var performance = {};
    exports.createReport = performance.createReport = function () {
        console.log("Preparing tests");

        var maxCopies = 2,
            configs = {},
            megabytes = 15,
            fileCount = 250,
            times = [],
            test = 1,
            promises = [];

        configs = [];
        configs.push({dedupe: {minLength: 0}});
        configs.push({dedupe: {minLength: 20}});

        var totalTests = maxCopies * Object.keys(configs).length;

        del.sync("test/performance");

        for (var copy = 1; copy <= maxCopies; ++copy) {
            fse.copySync('test/testdata/performance', 'test/performance/performance' + copy);
            for (var c = 0; c < configs.length; ++c) {

                console.log(
                    "\n\nRunning performance test " + test++ + " of " + totalTests + "; # Files: "
                    + fileCount * copy + ", Size: " + megabytes * copy
                    + ", Config: " + JSON.stringify(configs[c]) + ".\n"
                );
                var wa = require('../index');
                var outDir = "test/output/performance/performance-" + copy + "-config_" + c;
                del.sync(outDir);

                var options = {
                    files: "test/performance/**",
                    output: outDir
                };
                options = mergeOptions(options, configs[c]);

                var begin = Date.now();
                wa.webArchiver(options);
                var end = Date.now();

                var timeSpent = ((end - begin) / 1000 / 60).toFixed(1) + " minutes";

                times.push({
                    '# Files': fileCount * copy,
                    'Size': megabytes * copy + " MB",
                    'Config': JSON.stringify(configs[c]),
                    'Time': timeSpent
                });

                outputSize(promises, times, times.length - 1, outDir);

            }

        }

        Promise.all(promises).then(function () {
            var data = [];
            var header = [];
            for (var k in times[0]) {
                if (times[0].hasOwnProperty(k)) {
                    header.push(k);
                }
            }
            data.push(header);
            for (var t = 0; t < times.length; ++t) {
                var row = [];
                for (var k in times[t]) {
                    if (times[t].hasOwnProperty(k)) {
                        row.push(times[t][k]);
                    }
                }
                data.push(row);
            }
            console.log("\n\n" + table(data));

        });


    };

    if (!module.parent) {
        performance.createReport();
    }
})();