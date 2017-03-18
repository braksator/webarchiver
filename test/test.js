'use strict';

var fs = require('fs');
var chai = require('chai');
chai.use(require('chai-fs'));
var expect = chai.expect;
var assert = chai.assert;
var app = require('../index');

const del = require('del');

var lint = require('mocha-eslint');

// Linting paths.
var paths = [
    'index.js',
    'test/test.js'
];

// Linting options.
var options = {
    // Specify style of output
    formatter: 'compact',  // Defaults to `stylish`

    // Only display warnings if a test is failing
    alwaysWarn: false,  // Defaults to `true`, always show warnings

    // Increase the timeout of the test if linting takes to long
    timeout: 5000,  // Defaults to the global mocha `timeout` option

    // Increase the time until a test is marked as slow
    slow: 1000,  // Defaults to the global mocha `slow` option

    // Consider linting warnings as errors and return failure
    strict: true  // Defaults to `false`, only notify the warnings
};

// Run the lint.
lint(paths, options);


// Tests
describe('#startPath', function () {
    it('should determine common prefix path from paths', function () {
        var dirs = ['var/www/html/index.html', 'var/www/html/index.bkp', 'var/www/html/includes/header.php'];
        var result = app.getStartPath(dirs);
        expect(result).to.equal('var/www/html/');
    });

});

describe('#outDir', function () {
    it('should output to the same directory', function () {
        app.options = {inPlace: true};
        app.startPath = 'var/www/html/';
        var result = app.getOutDir();
        expect(result).to.equal('var/www/html/');
    });

    it('should output to the output directory', function () {
        app.options = {output: 'output'};
        app.startPath = 'var/www/html/';
        var result = app.getOutDir();
        expect(result).to.equal('output/');
    });

    it('should output to the output directory but also nest the input paths', function () {
        app.options = {output: 'output', fullNest: true};
        app.startPath = 'var/www/html/';
        var result = app.getOutDir();
        expect(result).to.equal('output/var/www/html/');
    });

});

describe('#fragments', function () {

    it('should do conditional fragment matching', function () {
        // Should match 'inters', not 'inter' (most common) or 'interst' (longest).
        // because we only allow fragments to end in 's'.
        var input = ["interstellar", "interstate", "interstitial", "interesting"];
        var min = 3;
        app.batchCreate('matches');
        app.varName = 'a';
        app.options = {dedupe: {minOcc: 0, minSaving: 1}};
        var re = new RegExp("(.*?[" + ['s'].join('') + "]+)", "g");
        for (var i = 0; i < input.length; i++) {
            var a = input[i].split(re).filter(Boolean);
            for (var j = 0; j <= i; j++) {
                var b = input[j].split(re).filter(Boolean);
                app.fragmentMatches([], a, b, i, j, min);
            }
        }
        var matchResult = app.batchRead('matches', 'inters', 'str');
        expect(matchResult.value).to.deep.equal({str: 'inters', occ: {'0': [0], '1': [0], '2': [0]}});

    });

    it('should do repeated HTML fragment matching', function () {
        var input = ["<test>test</test><test>test</test>"];
        var min = 3;
        app.batchCreate('matches');
        app.varName = 'a';
        app.options = {dedupe: {minOcc: 0, minSaving: 1}};
        var re = new RegExp("(.*?[" + ['>', ';', '}', '\\n', '\\s'].join('') + "]+)", "g");
        for (var i = 0; i < input.length; i++) {
            var a = input[i].split(re).filter(Boolean);
            for (var j = 0; j <= i; j++) {
                var b = input[j].split(re).filter(Boolean);
                app.fragmentMatches([], a, b, i, j, min);
            }
        }

        var matchResult = app.batchRead('matches', '<test>test</test>', 'str');
        expect(matchResult.value).to.deep.equal({str: '<test>test</test>', occ: {'0': [0, 2]}});

    });

    it('should do complex HTML fragment matching', function () {
        var input = ["baz foo bar;<test>test</test><tag>foo bar; baz<test>test</test></tag>foo; bar baz"];
        var min = 3;
        app.batchCreate('matches');
        app.varName = 'a';
        app.options = {dedupe: {minOcc: 0, minSaving: 1}};
        var startsWith = ['<', '{', '\\(', '\\[', '"', "'"];
        var endsWith = ['>', '}', '\\)', '\\]', '.', '"', '\'', ';', '\\n', '\\s'];
        var re = new RegExp("([" + startsWith.join('') + "]?[^" + startsWith.join('') + "" + endsWith.join('') + "]*[" + endsWith.join('') + "]?){1}", "g");
        for (var i = 0; i < input.length; i++) {
            var a = input[i].split(re).filter(Boolean);
            for (var j = 0; j <= i; j++) {
                var b = input[j].split(re).filter(Boolean);
                app.fragmentMatches([], a, b, i, j, min);
            }
        }
        var matchResult = app.batchRead('matches', 'foo bar;', 'str');
        expect(matchResult.value).to.deep.equal({str: 'foo bar;', occ: {'0': [1, 7]}});
        matchResult = app.batchRead('matches', '<test>test</test>', 'str');
        expect(matchResult.value).to.deep.equal({str: '<test>test</test>', occ: {'0': [3, 11]}});
        matchResult = app.batchRead('matches', 'baz', 'str');
        expect(matchResult.value).to.deep.equal({str: 'baz', occ: {'0': [10, 18]}});

    });

});

describe('#minify', function () {

    it('should handle a simple minification', function () {
        var html = "<b>Test</b>\n <p> A <em>paragraph</em> </p>\r\n\n    <style type=\"text/css\"> body { color: #ffffff; } </style>\n\n";
        app.options = {
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
            }
        };
        var result = app.minify(html);
        expect(result).to.equal("<b>Test</b><p>A<em>paragraph</em></p><style>body{color:#fff}</style>");
    });

});


describe('#doReplace', function () {

    it('should replace a string that spans multiple array items', function () {
        app.files = {0: {}};
        var match = {str: 'aaaccc', var: 'v', reps: {}};
        var res = app.doReplace(['aaa', 'bbb', 'aaa', 'ccc', 'aaa', 'ddd'], match, app.files[0], 0);
        expect(res.join('')).to.equal("aaabbb'.$v.'aaaddd");
    });

});


describe('#nextVarName', function () {

    it('should change 9z ---> a0', function () {
        expect(app.nextVarName('z')).to.equal("a0");
    });
    it('should change z ---> a0', function () {
        expect(app.nextVarName('z')).to.equal("a0");
    });
    it('should change ab1zde ---> ab1zdf', function () {
        expect(app.nextVarName('ab1zde')).to.equal("ab1zdf");
    });
    it('should change abcdzz ---> abce00', function () {
        expect(app.nextVarName('abcdzz')).to.equal("abce00");
    });
    it('should change zzzzz ---> a00000', function () {
        expect(app.nextVarName('zzzzz')).to.equal("a00000");
    });
    it('should change abcyzz ---> abcz00', function () {
        expect(app.nextVarName('abcyzz')).to.equal("abcz00");
    });
    it('should change 9000 ---> 9001', function () {
        expect(app.nextVarName('9000')).to.equal("9001");
    });
    it('should change a9z ---> aa0', function () {
        expect(app.nextVarName('a9z')).to.equal("aa0");
    });
    it('should change a9 ---> aa', function () {
        expect(app.nextVarName('a9')).to.equal("aa");
    });
    it('should generate ten thousand unique vars', function () {
        this.timeout(20000);
        var v = 'a';
        var vars = [];
        for (var i = 0; i < 10000; i++) {
            v = app.nextVarName(v);
            assert.notInclude(vars, v);
            vars.push(v);
        }
    });

});


describe('#disable', function () {

    it('should disable form elements', function () {
        var html = '<form><input type="text" /><textarea></textarea><input type="submit" value="go" /></form>';
        app.options = {disable: ['button', 'input', 'options', 'select', 'textarea']};

        var res = app.disable(html);
        expect(res).to.equal('<form><input disabled type="text" /><textarea disabled></textarea><input disabled type="submit" value="go" /></form>');
        app.options.disable = false;
    });

});


describe('#commandLine', function () {

    it('should run as a command', function (done) {
        this.timeout(30000);
        var dir = "test/output/single";

        // First delete the dir and confirm it isn't there.
        del.sync(dir);
        expect(dir).to.not.be.a.path();

        var exec = require('child_process').exec;
        var cmd = 'node ./index.js --files "test/testdata/single.html" --output ' + dir;

        // Act
        exec(cmd, function (error, stdout, stderr) {
            // Assert

            // Does the output directory exist now?
            assert.isDirectory(dir, "Is Directory");

            // Does the output differ from the input?
            var buf1 = fs.readFileSync('./test/output/single/single.html');
            var buf2 = fs.readFileSync('./test/testdata/single.html');
            expect(buf1.toString()).to.not.equal(buf2.toString());

            // Does the output contain PHP replacements?
            expect(buf1.toString()).to.include("<?php");
            expect(buf1.toString()).to.include("'.$");

            done();

        });

    });

});


describe('#webArchiver', function () {

    it('should throw an error when no options given', function () {
        expect(function () {
            app.webArchiver();
        }).to.throw("No options given.");
    });

    it('should throw an error when options is empty', function () {
        expect(function () {
            app.webArchiver({});
        }).to.throw("No input files defined in options.");
    });

    it('should throw an error when files are not found', function () {
        var dir = "test/single";
        expect(function () {
            app.webArchiver({
                files: "bogus.file.pattern",
                output: dir
            });
        }).to.throw("No input files found.");
    });

    it('should throw an error when output options do not make sense', function () {
        expect(function () {
            app.webArchiver({files: "test/testdata/*.html"});
        }).to.throw("You must set either 'output' or 'inplace'.");
    });

    it('should archive a single file to new directory', function () {
        // Arrange
        this.timeout(20000);
        var dir = "test/output/single";

        // First delete the dir and confirm it isn't there.
        del.sync(dir);
        expect(dir).to.not.be.a.path();

        var options = {
            files: "test/testdata/single.html",
            output: dir
        };

        // Act
        var result = app.webArchiver(options);

        // Assert

        // Does the output directory exist now?
        assert.isDirectory(dir, "Is Directory");

        // Does the output differ from the input?
        var buf1 = fs.readFileSync('./test/output/single/single.html');
        var buf2 = fs.readFileSync('./test/testdata/single.html');
        expect(buf1.toString()).to.not.equal(buf2.toString());

        // Does the output contain PHP replacements?
        expect(buf1.toString()).to.include("<?php");
        expect(buf1.toString()).to.include("'.$");
    });


    it('should archive a single file to new directory without deduplication', function () {
        // Arrange
        this.timeout(20000);
        var dir = "test/output/single-nodedupe";

        // First delete the dir and confirm it isn't there.
        del.sync(dir);
        expect(dir).to.not.be.a.path();

        var options = {
            files: "test/testdata/single.html",
            output: dir,
            noProgress: true,
            dedupe: false
        };

        // Act
        var result = app.webArchiver(options);

        // Assert

        // Does the output directory exist now?
        assert.isDirectory(dir, "Is Directory");

        // Does the output contain PHP replacements?
        var buf = fs.readFileSync('./test/output/single-nodedupe/single.html');
        expect(buf.toString()).to.not.include("<?php");
        expect(buf.toString()).to.not.include("'.$");

        // Does the output differ from the output of a test without this condition?
        var buf3 = fs.readFileSync('./test/output/single/single.html');
        expect(buf.toString()).to.not.equal(buf3.toString());
    });

    it('should archive a single file to new directory without minification', function () {
        // Arrange
        this.timeout(20000);
        var dir = "test/output/single-nominify";

        // First delete the dir and confirm it isn't there.
        del.sync(dir);
        expect(dir).to.not.be.a.path();

        var options = {
            files: "test/testdata/single.html",
            output: dir,
            noProgress: true,
            minify: false
        };

        // Act
        var result = app.webArchiver(options);

        // Assert

        // Does the output directory exist now?
        assert.isDirectory(dir, "Is Directory");

        // Does the output differ from the input?
        var buf1 = fs.readFileSync('./test/output/single-nominify/single.html');
        var buf2 = fs.readFileSync('./test/testdata/single.html');
        expect(buf1.toString()).to.not.equal(buf2.toString());

        // Does the output contain PHP replacements?
        expect(buf1.toString()).to.include("<?php");
        expect(buf1.toString()).to.include("'.$");

        // Does the output differ from the output of a test without this condition?
        var buf3 = fs.readFileSync('./test/output/single/single.html');
        expect(buf1.toString()).to.not.equal(buf3.toString());
    });

    it('should archive a single file to new directory without minification or deduplication', function () {
        // Arrange
        this.timeout(20000);
        var dir = "test/output/single-nothing";

        // First delete the dir and confirm it isn't there.
        del.sync(dir);
        expect(dir).to.not.be.a.path();

        var options = {
            files: "test/testdata/single.html",
            output: dir,
            noProgress: true,
            minify: false,
            dedupe: false
        };

        // Act
        var result = app.webArchiver(options);

        // Assert

        // Does the output directory exist now?
        assert.isDirectory(dir, "Is Directory");

        // Does the output match the input?
        var buf1 = fs.readFileSync('./test/output/single-nothing/single.html');
        var buf2 = fs.readFileSync('./test/testdata/single.html');
        expect(buf1.toString()).to.equal(buf2.toString());

        // Does the output not contain PHP replacements?
        expect(buf1.toString()).to.not.include("<?php");
        expect(buf1.toString()).to.not.include("'.$");

        // Does the output differ from the output of a test without this condition?
        var buf3 = fs.readFileSync('./test/output/single/single.html');
        expect(buf1.toString()).to.not.equal(buf3.toString());
    });

    it('should archive two files to new directory', function () {
        // Arrange
        this.timeout(20000);

        var dir = "test/output/double";

        // First delete the dir and confirm it isn't there.
        del.sync(dir);
        expect(dir).to.not.be.a.path();

        var options = {
            files: "test/testdata/double*",
            noProgress: true,
            output: dir,
            dedupe: {
                minLength: 0
            }
        };

        // Act
        var result = app.webArchiver(options);

        // Assert

        // Does the output directory exist now?
        assert.isDirectory(dir, "Is Directory");

        // Unsure how to assert further...
    });

    it('should archive multiple files to new directory', function () {
        // Arrange
        this.timeout(60000);

        var dir = "test/output/multiple";

        // First delete the dir and confirm it isn't there.
        del.sync(dir);
        expect(dir).to.not.be.a.path();

        // Act
        var options = {
            files: ["test/testdata/multiple*"],
            output: dir,
            passes: 3,
            slugify: true,
            slugifyIgnore: ['gaters.net -'],
            searchReplace: {search: ['http://162.244.93.21/~gatersne/vbdec2002/'], replace: ['#']},
            writeState: true,
            dedupe: {
                minLength: 20,
                minOcc: 3
            }
        };

        var result = app.webArchiver(options);

        // Assert

        // Does the output directory exist now?
        assert.isDirectory(dir, "Is Directory");

        // Unsure how to assert further...
    });


    it('should skip PHP files', function () {
        // Arrange
        this.timeout(20000);

        var dir = "test/output/skip";

        // First delete the dir and confirm it isn't there.
        del.sync(dir);
        expect(dir).to.not.be.a.path();

        var options = {
            files: "test/testdata/skip.php",
            output: dir,
            noProgress: true
        };

        // Act
        var result = app.webArchiver(options);

        // Assert

        // Does the output directory exist now?
        assert.isDirectory(dir, "Is Directory");

        // Does the output match the input?
        var buf1 = fs.readFileSync(dir + '/skip.php');
        var buf2 = fs.readFileSync('./test/testdata/skip.php');
        expect(buf1.toString()).to.equal(buf2.toString());
    });


    it('should archive nested file', function () {
        // Arrange
        this.timeout(20000);

        var dir = "test/output/nested";

        // First delete the dir and confirm it isn't there.
        del.sync(dir);
        expect(dir).to.not.be.a.path();

        var options = {
            files: ["test/testdata/nested", "test/testdata/nested/**", "test/testdata/unnested.html"],
            output: dir,
            noProgress: true
        };

        // Act
        var result = app.webArchiver(options);

        // Assert

        // Does the output directory exist now?
        assert.isDirectory(dir, "Is Directory");

        // Does the include in the file have the relative directory dots?
        var buf1 = fs.readFileSync(dir + '/nested/nested.html');
        assert.include(buf1.toString(), "include '../v.php';", '');
    });

    it('should full nest nested file', function () {
        // Arrange
        this.timeout(20000);

        var dir = "test/output/nested";

        // First delete the dir and confirm it isn't there.
        del.sync(dir);
        expect(dir).to.not.be.a.path();

        var options = {
            files: ["test/testdata/nested", "test/testdata/nested/**", "test/testdata/unnested.html"],
            output: dir,
            noProgress: true,
            fullNest: 1
        };

        // Act
        var result = app.webArchiver(options);

        // Assert

        // Does the output directory exist now?
        assert.isDirectory(dir, "Is Directory");

        // Does the include in the file have the relative directory dots?
        var buf1 = fs.readFileSync(dir + '/test/testdata/nested/nested.html');
        assert.include(buf1.toString(), "include '../v.php';", '');

        // Does the vfile exist at the output dir + common start path location?
        assert.isFile(dir + '/test/testdata/v.php', "Is File");
    });

    it('should just copy file', function () {
        // Arrange
        this.timeout(20000);

        var dir = "test/output/justcopy";

        // First delete the dir and confirm it isn't there.
        del.sync(dir);
        expect(dir).to.not.be.a.path();

        var options = {
            files: ["test/testdata/justcopy.html"],
            justCopy: ["test/testdata/justcopy.html"],
            output: dir,
            noProgress: true
        };

        // Act
        var result = app.webArchiver(options);

        // Assert

        // Does the output directory exist now?
        assert.isDirectory(dir, "Is Directory");

        // Is the output the same as the input?
        var buf1 = fs.readFileSync(dir + '/justcopy.html');
        var buf2 = fs.readFileSync('./test/testdata/justcopy.html');
        assert.include(buf1.toString(), buf2.toString(), '');
    });


    it('should handle binary files properly', function (done) {
        // Arrange
        this.timeout(20000);

        var dir = "test/output/binary";

        // First delete the dir and confirm it isn't there.
        del.sync(dir);
        expect(dir).to.not.be.a.path();

        var options = {
            files: ["test/testdata/binary/*"],
            output: dir,
            noProgress: true
        };

        // Act
        var result = app.webArchiver(options);

        // Assert

        // Does the output directory exist now?
        assert.isDirectory(dir, "Is Directory");

        // Were the files created?
        setTimeout(function () {
            expect(dir + "/lena_std.jpg").to.be.a.path();
            expect(dir + "/sample.bin").to.be.a.path();
            /*
             var bytes_old = fs.statSync("test/testdata/binary/lena_std.jpg").size;
             var bytes_new = fs.statSync(dir + "/lena_std.jpg").size;
             assert.isBelow(bytes_new, bytes_old, '');
             */
            done();
        }, 1000);

    });

});

