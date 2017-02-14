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
        var result = app.startPath(dirs);
        expect(result).to.equal('var/www/html/');
    });

});

describe('#outDir', function () {
    it('should output to the same directory', function () {
        var result = app.outDir('var/www/html/', true, null, null);
        expect(result).to.equal('var/www/html/');
    });

    it('should output to the output directory', function () {
        var result = app.outDir('var/www/html/', false, 'output', null);
        expect(result).to.equal('output/');
    });

    it('should output to the output directory but also nest the input paths', function () {
        var result = app.outDir('var/www/html/', false, 'output', true);
        expect(result).to.equal('output/var/www/html/');
    });

});

describe('#fragments', function () {

    it('should do conditional fragment matching', function () {
        // Should match 'inters', not 'inter' (most common) or 'interst' (longest).
        // because we only allow fragments to end in 's'.
        var input = ["interstellar", "interstate", "interstitial", "interesting"];
        var min = 3;
        var long = [];
        var re = new RegExp("(.*?[" + ['s'].join('') + "]+)", "g");
        for (var i = 0; i < input.length; i++) {
            var a = input[i].split(re).filter(Boolean);
            for (var j = 0; j <= i; j++) {
                var b = input[j].split(re).filter(Boolean);
                app.fragments(long, a, b, i, j, min);
            }
        }
        expect(long).to.deep.equal([{str: 'inters', len: 6, alen: 1, occ: {'0': [0], '1': [0], '2': [0]}}]);

    });

    it('should do repeated HTML fragment matching', function () {
        var input = ["<test>test</test><test>test</test>"];
        var min = 3;
        var long = [];
        var re = new RegExp("(.*?[" + ['>', ';', '}', '\\n', '\\s'].join('') + "]+)", "g");
        for (var i = 0; i < input.length; i++) {
            var a = input[i].split(re).filter(Boolean);
            for (var j = 0; j <= i; j++) {
                var b = input[j].split(re).filter(Boolean);
                app.fragments(long, a, b, i, j, min);
            }
        }

        expect(long).to.deep.equal([{
            str: '<test>test</test>',
            len: 17,
            alen: 2,
            occ: {'0': [0, 2]}
        }]);

    });

    it('should do complex HTML fragment matching', function () {
        var input = ["baz foo bar;<test>test</test><tag>foo bar; baz<test>test</test></tag>foo; bar baz"];
        var min = 3;
        var long = [];

        var startsWith = ['<', '{', '\\(', '\\[', '"', "'"];
        var endsWith = ['>', '}', '\\)', '\\]', '.', '"', '\'', ';', '\\n', '\\s'];
        var re = new RegExp("([" + startsWith.join('') + "]?[^" + startsWith.join('') + "" + endsWith.join('') + "]*[" + endsWith.join('') + "]?){1}", "g");
        for (var i = 0; i < input.length; i++) {
            var a = input[i].split(re).filter(Boolean);
            for (var j = 0; j <= i; j++) {
                var b = input[j].split(re).filter(Boolean);
                app.fragments(long, a, b, i, j, min);
            }
        }
        expect(long).to.deep.equal([{str: 'foo bar;', len: 8, alen: 2, occ: {'0': [1, 7]}},
            {
                str: '<test>test</test>',
                len: 17,
                alen: 3,
                occ: {'0': [3, 11]}
            },
            {str: 'baz', len: 3, alen: 1, occ: {'0': [10, 18]}}]
        );

    });

});

describe('#minify', function () {

    it('should handle a simple minification', function () {
        var html = "<b>Test</b>\n <p> A <em>paragraph</em> </p>\r\n\n    <style type=\"text/css\"> body { color: #ffffff; } </style>\n\n";
        var result = app.minify(html);
        expect(result).to.equal("<b>Test</b><p>A<em>paragraph</em></p><style>body{color:#fff}</style>");
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
        }).to.throw("You must set the 'inplace' option to true or provide an output directory path to 'output'.");
    });

    it('should archive a single file to new directory', function () {
        this.timeout(20000);
        var dir = "test/output/single";

        // First delete the dir and confirm it isn't there.
        del.sync(dir);
        expect(dir).to.not.be.a.path();

        var options = {
            files: "test/testdata/single.html",
            output: dir
        };

        var result = app.webArchiver(options);
        assert.isDirectory(dir, "Is Directory");
    });

    it('should archive two files to new directory', function () {
        this.timeout(20000);

        var dir = "test/output/double";

        // First delete the dir and confirm it isn't there.
        del.sync(dir);
        expect(dir).to.not.be.a.path();

        var options = {
            files: "test/testdata/double*",
            output: dir,
            //dedupe: false
        };

        var result = app.webArchiver(options);
        assert.isDirectory(dir, "Is Directory");
    });

    it('should archive multiple files to new directory', function () {
        this.timeout(40000);

        var dir = "test/output/multiple";

        // First delete the dir and confirm it isn't there.
        del.sync(dir);
        expect(dir).to.not.be.a.path();

        var options = {
            files: "test/testdata/multiple*",
            output: dir
        };

        var result = app.webArchiver(options);
        assert.isDirectory(dir, "Is Directory");
    });


    it('should skip PHP files', function () {
        this.timeout(20000);

        var dir = "test/output/skip";

        // First delete the dir and confirm it isn't there.
        del.sync(dir);
        expect(dir).to.not.be.a.path();

        var options = {
            files: "test/testdata/skip.php",
            output: dir
        };

        var result = app.webArchiver(options);
        assert.isDirectory(dir, "Is Directory");

        var buf1 = fs.readFileSync(dir + '/skip.php');
        var buf2 = fs.readFileSync('./test/testdata/skip.php');
        expect(buf1.toString()).to.equal(buf2.toString());
    });


    it('should archive nested file', function () {
        this.timeout(20000);

        var dir = "test/output/nested";

        // First delete the dir and confirm it isn't there.
        del.sync(dir);
        expect(dir).to.not.be.a.path();

        var options = {
            files: ["test/testdata/nested", "test/testdata/nested/nested.html", "test/testdata/unnested.html"],
            output: dir
        };

        var result = app.webArchiver(options);
        assert.isDirectory(dir, "Is Directory");

        var buf1 = fs.readFileSync(dir + '/nested/nested.html');
        assert.include(buf1.toString(), "include '../v.php';", '');
    });


    it('should just copy file', function () {
        this.timeout(20000);

        var dir = "test/output/justcopy";

        // First delete the dir and confirm it isn't there.
        del.sync(dir);
        expect(dir).to.not.be.a.path();

        var options = {
            files: ["test/testdata/justcopy.html"],
            justcopy: ["test/testdata/justcopy.html"],
            output: dir
        };

        var result = app.webArchiver(options);
        assert.isDirectory(dir, "Is Directory");

        var buf1 = fs.readFileSync(dir + '/justcopy.html');
        var buf2 = fs.readFileSync('./test/testdata/justcopy.html');
        assert.include(buf1.toString(), buf2.toString(), '');
    });


    it('should handle binary files properly', function (done) {
        this.timeout(20000);

        var dir = "test/output/binary";

        // First delete the dir and confirm it isn't there.
        del.sync(dir);
        expect(dir).to.not.be.a.path();

        var options = {
            files: ["test/testdata/binary/*"],
            output: dir
        };

        var result = app.webArchiver(options);
        assert.isDirectory(dir, "Is Directory");

        setTimeout(function () {
            expect(dir + "/lena_std.jpg").to.be.a.path();
            expect(dir + "/sample.bin").to.be.a.path();
            /*
            var bytes_old = fs.statSync("test/testdata/binary/lena_std.jpg").size;
            var bytes_new = fs.statSync(dir + "/lena_std.jpg").size;
            assert.isBelow(bytes_new, bytes_old, '');
            */
            done();
        }, 3000);

    });

});

