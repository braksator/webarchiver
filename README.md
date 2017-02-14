WebArchiver
===========

Deduplicates and compresses a collection of website files and the resulting files must be interpreted with PHP.

Intended to optimize storage space for static website archives using deduplication, and minification.
Works particularly well for large generated websites that have been pulled with wget or curl.  The resulting text files
will retain their original file extensions but must be preprocessed with PHP.  Text files already containing what could
potentially be PHP code will not be changed.  Binary files other than images will be unchanged.  You can control which
of the files are just copied over (left unchanged).

## Background
    I wrote this because I restored a backup of an old vBulletin forum that I used to run.  Not wanting to maintain the
    vBulletin software any longer I decided to simply generate a static version of the website, but found that it was
    several Gigabytes in size.  Trying to deduplicate it manually was too difficult, so I wrote this module.

## Installation

   This is a Node.JS module available from the Node Package Manager (NPM).

   Here's the command to download and install from NPM:

  `npm install webarchiver`

## Usage

    ### Using Grunt task runner
        @todo

    ### Using Gulp build system
        @todo

    ### In a Node.js module

        ```javascript
        var webarchiver = require('webarchiver').webArchiver;

        webarchiver({
            files: "path/to/my/files/**",
            output: "path/to/output"
        });
        ```
        This module exports all of it's functions so you can potentially overwrite some parts of it too!


## Options

    You may override some or all of these options.

    | Option name       | Type          | Description                                                                                                               | Default       |
    | ---               | ---           | ---                                                                                                                       |---            |
    | files             | string        | A glob pattern that indicates which files to process, or an array of glob strings.                                        |               |
    | justcopy          | bool          | Glob string/array of files to not process.                                                                                |               |
    | inplace           | bool          | If set to true will modify the existing files rather than creating new files.                                             |               |
    | output            | string        | The path of an output directory if options.inplace is not used.                                                           |               |
    | dedupe            | object|false  | Options to override deduplication behaviour as per the common-substrings package (or set to false to not deduplicate).    | (See below)   |
    | minify            | object|false  | Options to override minification behaviour as per the html-minifier package (or set to false to not minify).              | (See below)   |
    | vfile             | string        | The name of the php variables file if 'v.php' is not acceptable.                                                          | 'v.php'       |
    | dbdir             | string        | The name of the key-file storage directory if 'vdb' is not acceptable.                                                    | 'vdb'         |
    | fullnest          | bool          | Whether to maintain full path nesting in the output directory.                                                            | false         |
    | cache             | int|bool      | The size of the memory cache in terms of key-values, true for unlimited, false for none.                                  | 500           |
    | keepdb            | bool          | Whether to keep the key-file storage after completion, useful for batching.                                               |               |
    | skipcontaining    | bool          | An array of strings, if a text file contains any of them it will be 'just copied'.                                        | ['<?']        |


## Dedupe options

    Deduplication is performed on files that don't appear to contain binary data, aren't matched with **options.justcopy**,
    and don't contain strings in **options.skipcontaining**.

    To speed up deduplication the file is analyzed in fragments where the fragments either start with a character in
    **options.dedupe.startsWith**, or end with a character listed in **options.dedupe.endsWith**.  Multiple fragments may
    be joined together to create a duplication match, but no match will be smaller than a fragment.   Deduplication is
    performed after minification to increase the chances of a match.

    The deduplication of the file is reconstructed on the server with PHP preprocessing.  Therefore each file is prepended
    with a PHP include to a file with the replacement variables (**options.vfile**) and the contents of the file is echo'd
    as a PHP string.  This works with HTML/CSS/JS files if they are set to be preprocessed by PHP on the server.

    Replacements are performed in the string by substituting portions of duplicated text with '.$var.' - where the names of
    the vars are automatically generated to be as short as possible.  Therefore each file has some overhead (28 chars), each
    replacement instance has some overhead (6+ chars), and the storage of the original text has some overhead too.

    Due to the overhead it is advisable to not choose a particularly small value for (**options.dedupe.minLength**).

    | Option name       | Type          | Description                                                               | Default                                       |
    | ---               | ---           | ---                                                                       |---                                            |
    | minLength         | int           | The minimum length a string of text must be to deduplicate it.            | 20                                            |
    | startsWith        | char[]        | Regex escaped chars that a fragment can start with.                       | ['<', '{', '\\(', '\\[', '"']                 |
    | endsWith          | char[]        | Regex escaped chars that a fragment can end with.                         | ['>', '}', '\\)', '\\]', '"', '\\n', '\\s']   |

    Warning: Don't add . or $ or ' into startsWith/endsWith.

    You may override some or all of these options at **options.dedupe**, your options will be merged into the defaults.
    You can set **options.dedupe** to false to disable deduplication.

## Minify options

    Minification is performed on files that don't appear to contain binary data, aren't matched with **options.justcopy**,
    and don't contain strings in **options.skipcontaining**.

    Minification is performed by [HTML Minifier](https://www.npmjs.com/package/html-minifier).  It handles HTML, CSS, and JS.

    Please see HTML Minifier's docs for a description of the options.  Here is the default option object this module uses:
    ```
        {
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
    ```
    You may override some or all of these options at **options.minify**, your options will be merged into the defaults.
    You can set **options.minify** to false to disable minification.

## Why PHP?
    PHP is common, hosting is cheap, lots of people understand it, and syntactically it is quite succinct for our
    purposes.  It seems like an ideal choice here.  However, I am open to be convinced to support another method of
    preprocessing.

    While we're on the subject the PHP generated here is **basic**.  **Include** and **echo** statements, variable
    assignment, and string concatenation.  You should have no worries about which version of PHP to run.

## What else?
    You should also consider compressing your images.  Many websites do not correctly compress their images, particularly
    older websites you may be archiving.  There are several NPM packages you could use to automate this process, like
    **grunt-contrib-imagemin** or **gulp-imagemin**.

## Future
    I have some more ideas for this package which I may pursue:

    + Pull down remote websites to archive.  Currently it only works on static files you already have.
    + Rename files (and links to those files) based on title tag.  Would be a bonus for SEO.
    + Option to serve files through an index.php instead of accessing directly.  This would allow you to modify the index
    file to add additional prepended/appended PHP/HTML, custom CSS, and custom scripts across all of the files.
    + Extract contents of style and script tags into separate files.  This would allow them to be cached client-side.
    + I wanted to support image compression out of the box, but that proved more time-consuming than I'd hoped, could be
    revisited.
    + I had the foresight to include **options.keepdb** for batching/resuming jobs, but wound back the other work I did on
    that.  Might be a nice feature though so it's worth thinking about again.

## BTW...

    By the way here is the command I used to rip the vBulletin site down to my hard drive:

    ```
    wget -r http://website.address/directory --convert-links=on --html-extension=on --page-requisites --accept '*.html,showthread.php*,forumdisplay.php*,member.php,images*,*.gif,*.png,*.jpg,*.jpeg,*.css,*.js,clientscript*' --reject "*?p=*,*goto=*,*sort=*,*order=*,*daysprune=*"
    ```

    Perhaps that could help someone.

## Tests

  `npm test`

  To check coverage you have to install istanbul globally:
  `npm install istanbul -g`
  and then execute:
  `npm run coverage`
  A coverage summary will be displayed and a full coverage report will appear in the /coverage directory.

## Contributing

    In lieu of a formal style guide, take care to maintain the existing coding style. Add mocha tests for coverage and explicitly test bugs.

