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

`npm install webarchiver -S`

## Usage

### In a Node.js module

The easiest way is to just `npm init` a new project, and stick your website files in a sub-directory.  Create your
index.js file and put this in:

```javascript
var wa = require('webarchiver');

wa.webArchiver({
    files: "website/**",
    output: "archived"
});
```
Where 'website' is the directory containing your files and 'archived' is the non-existent directory where the archive
will be written.

Now type `node index.js` and let it go to work.

#### More Examples

Finds more duplicates, but runs very slow:

```javascript
var wa = require('webarchiver');

console.time('wa');
wa.webArchiver({
    files: "website/**",
    output: "archived",
    passes: 3,
    dedupe: {
        minLength: 0,
        minSaving: 8,
        startsWith: ['<', '{', '\\(', '\\[', '"', "\\'", '#', '\\.'],
        endsWith: ['>', '}', '\\)', '\\]', '"', "\\'", '\\n', '\\s', ';']
    }
});
console.timeEnd('wa');
```

Finds fewer duplicates, but runs faster:

```javascript
var wa = require('webarchiver');

console.time('wa');
wa.webArchiver({
    files: "website/**",
    output: "archived",
    passes: 1,
    dedupe: {
        minLength: 25,
        minSaving: 15,
        startsWith: ['<'],
        endsWith: ['>', '\\n']
    }
});
console.timeEnd('wa');
```

Finding too many duplicates can lead to poorer compression, see the *Dedupe options* and *Performance* sections for a
discussion.

### Command line

It is also possible to run it as a command like so:

```
node ./node_modules/webarchiver --files "website/**" --output "archived"
```

For array values, provide the option multiple times, e.g.: `--files "pattern1" --files "pattern2"`
For dedupe and minify values just use a dot, e.g.: `--dedupe.minLength 20`
- This might not accept HTML Minifier's regex options.

## Customization

This module exports all of its functions so you can potentially overwrite some parts of it! Some interesting ones are
`replacementAllowed` which lets you reject a deduplication match, and `varCode` which can alter the variable name used
in the PHP output.  Simply use `wa.functionName = function() { // your new code here };` before using `wa.webArchiver...`
to overwrite functions.  Similarly any variables used like `this.variableName` can be altered with
`wa.variableName = [your value];`.

If you just want the deduplicator logic you'll probably want to look at `createFragments` for preparing the string into
a fragment array, `fragmentMatches` for finding duplicates (and look at how its used by `findDuplicates`), and `doReplace`
for performing replacements on a fragment array (or use `replaceAll` with a string escaped with `escapeRegExp`).

## Options

You may override some or all of these options.

| Option name       | Type          | Description                                                                                                               | Default       |
| ---               | ---           | ---                                                                                                                       |---            |
| files             | string/array  | A glob pattern that indicates which files to process and output, or an array of glob patterns.                            |               |
| output            | string        | The path of an output directory (doesn't need to exist yet) if options.inPlace is not used.                               |               |
| justCopy          | string/array  | Glob pattern(s) of files (that are also found in 'files') to not process with compression but still output.               | false         |
| inPlace           | bool          | If set to true will modify the existing files rather than creating new files.  Not recommended.                           | false         |
| dedupe            | object/false  | Options to override deduplication behaviour (or set to false to not deduplicate - why would you?).                        | (See below)   |
| minify            | object/false  | Options to override minification behaviour as per the html-minifier package (or set to false to not minify).              | (See below)   |
| vFile             | string        | The name of the php variables file if 'v.php' is not acceptable.                                                          | 'v.php'       |
| fullNest          | bool          | Whether to nest the full input path into the output directory.  You shouldn't need this in most cases.                    | false         |
| skipContaining    | bool          | An array of strings; if a text file contains any of them the file will be treated as though it was matched in justCopy.   | ['<?']        |
| noProgress        | bool          | Set to true to disable the progress bar.                                                                                  | false         |
| passes            | int           | Number of deduplication passes.  Often things are missed on first pass.  Can increase for extra dedupe checks.            | 2             |


## Dedupe options

Deduplication is performed on files that don't appear to contain binary data, aren't matched with *options.justCopy*,
and don't contain strings in *options.skipContaining*.

To speed up deduplication the file is analyzed in fragments where the fragments either start with a character in
*options.dedupe.startsWith*, or end with a character listed in *options.dedupe.endsWith*.  Multiple fragments may
be joined together to create a duplication match, but no match will be smaller than a fragment.   Deduplication is
performed after minification to increase the chances of a match.

The deduplication of the file is reconstructed on the server with PHP preprocessing.  Therefore each file is prepended
with a PHP include to a file with the replacement variables (*options.vFile*) and the contents of the file is echo'd
as a PHP string.  This works with HTML/CSS/JS files if they are set to be preprocessed by PHP on the server.

Replacements are performed in the string by substituting portions of duplicated text with '.$var.' - where the names of
the vars are automatically generated to be as short as possible.  Therefore each file has some overhead (28 chars), each
replacement instance has some overhead (6+ chars*, or 3+ chars* when adjacent to another replacement), and the storage of
the original text has some overhead too (6 chars for the vFile header and 6+ chars* per string plus the length of the string).

> *The plus (+) refers to the fact that replacement variable names start out at a length of one character and
> increase in size as the program runs, the schedule for how many variables of each length are used is as follows:
> 1: 26, 2: 936, 3: 33696, 4: 1213056 ... n: `36 ^ n - 10 * 36 ^ (n - 1)`
> (6+ chars in typical replacement: `'.$v.'` 3+ chars in adjacent replacement: `$v.` 6+ chars in vFile: `$v='';`)

Due to the overhead it is advisable to not choose a particularly small value for *options.dedupe.minSaving*.  The
default is already quite small and relies on there being several of most duplicates to justify replacement.   You may
want to set it higher!  Setting *options.dedupe.minLength* will speed up the algorithm, as the default of a falsey
value will automatically calculate it each time based on minSaving.  Setting minLength to greater than 0 but less than
minSaving + 6 is a poor choice for computing efficiency. Bottom line though; both minLength and minSaving will be
enforced no matter what you do here.

The more chars added in *options.dedupe.startsWith* and *options.dedupe.endsWith* the slower the deduplication tends
to go.  At the minimum for html you should just use '<' and '>', but the braces, brackets, and parenthesis will help with
JavaScript and CSS.  Line breaks should be rare with minification so they may as well be included.  Whitespace is included by
default as it is quite an effective addition but does significantly hurt performance.  Be aware that all chars are matched
within the text of the website too (this module does not consider the DOM structure), and whitespace is particularly
common in text.  Adding semi-colons to endsWith, dots and hashes to startsWith, and single & double quotes to both will
give higher fragmentation and more potential to identify duplicates but noticeably slow things down.

The following options are related to finding deduplication matches and performing deduplication replacements.  The main
options object contains configuration for additional deduplication behavior.

| Option name       | Type          | Description                                                               | Default                                                       |
| ---               | ---           | ---                                                                       |---                                                            |
| minLength         | int           | The minimum length a string of text must be to deduplicate. (0 = auto)    | 20                                                            |
| minSaving         | int           | The minimum length of string minus the replacement instance overhead      | 10                                                            |
| startsWith        | char[]        | Regex escaped chars that a fragment can start with.                       | ```['<', '{', '\\(', '\\[']```                                |
| endsWith          | char[]        | Regex escaped chars that a fragment can end with.                         | ```['>', '}', '\\)', '\\]', '\\n', '\\s']```                  |

You may override some or all of these options at *options.dedupe*, your options will be merged into the defaults.
You can set *options.dedupe* to false to disable deduplication.

## Minify options

Minification is performed on files that don't appear to contain binary data, aren't matched with *options.justCopy*,
and don't contain strings in *options.skipContaining*.

Minification is performed by [HTML Minifier](https://www.npmjs.com/package/html-minifier).  It handles HTML, CSS, and JS.

Please see HTML Minifier's docs for a description of the options.  Here is the default option object this module uses:
```
    {
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
    }
```
You may override some or all of these options at *options.minify*, your options will be merged into the defaults.
You can set *options.minify* to false to disable minification.

## Why PHP?

PHP is common, hosting is cheap, lots of people understand it, and syntactically it is quite succinct for our
purposes.  It seems like an ideal choice here.  However, I am open to be convinced to support another method of
preprocessing.

While we're on the subject the PHP generated here is quite basic; *Include* and *echo* statements, variable
assignment, and string concatenation.  You should have no worries about which version of PHP to run.

## What else?

You should also consider compressing your images.  Many websites do not correctly compress their images, particularly
older websites you may be archiving.  There are several NPM packages you could use to automate this process, like
*imagemin*.

## Future

I have some more ideas for this package which I may pursue:

+ Pull down remote websites to archive.  Currently it only works on static files you already have.
+ Rename files (and links to those files) based on title tag.  Would be a bonus for SEO.
+ Option to serve files through an index.php instead of accessing directly.  This would allow you to modify the index
file to add additional prepended/appended PHP/HTML, custom CSS, and custom scripts across all of the files.
+ Extract contents of style and script tags into separate files.  This would allow them to be cached client-side.
+ I wanted to support image compression out of the box, but that proved more time-consuming than I'd hoped, could be
revisited but not a high priority.
+ Possibly batching/resuming, or adding more files later should be supported.  I'm less enthusiastic about this idea
than I was previously.
+ Right now when a match is found it gets used, even though it might be a subset of a longer match in another file.  It
would be possible to perform a full analysis of the files first before deciding which replacements to use.  I suspect
the current algorithm's behaviour to match the first file against itself first is also a detriment in choosing matches.
+ When deciding if a replacement is allowed (i.e. replacementAllowed()), this module does not take into consideration
the number of occurrences of the duplicate (this data can be divined from match.occ) - it certainly could!

## BTW...

By the way here is the command I used to rip the vBulletin site down to my hard drive:

```
wget -r http://website.address/directory --convert-links=on --html-extension=on --page-requisites --accept '*.html,showthread.php*,forumdisplay.php*,member.php,images*,*.gif,*.png,*.jpg,*.jpeg,*.css,*.js,clientscript*' --reject "*?p=*,*goto=*,*sort=*,*order=*,*daysprune=*"
```

Perhaps that could help someone.


### Performance

With just a few hundred files the operation is relatively quick.  Each file must be deduplicated against all of the files
that came before, therefore the performance complexity of each file is greater than the previous file..  On the flip-side,
as more deduplication replacements are made, the previous files become smaller and faster to check.  Nevertheless processing
thousands of files, gigabytes of data, will require some patience.

A performance test is available in the github repo and can be executed with `npm run performance`. This data set
contains a high number of duplicates to really run this thing through the wringer.

| # Files | Size  | Passes | Config         | Time         | Output size |
| ------- | ----- | ------ | -------------- | ------------ | ----------- |
| 250     | 15 MB | 1      | minLength = 0  | 11.6 minutes | 2.71 MB     |
| 250     | 15 MB | 1      | minLength = 20 | 11.0 minutes | 2.70 MB     |
| 500     | 30 MB | 1      | minLength = 0  | 26.7 minutes | 2.97 MB     |
| 500     | 30 MB | 1      | minLength = 20 | 25.6 minutes | 2.92 MB     |

This shows how setting minLength to 0 (auto) is slower and can even result in worse compression than setting a higher
value.  It also shows that doubling the amount of data to process leads to MORE THAN double the processing time.  The
variables in the performance tests can be tweaked to test other conditions.

In earlier test cases, with a different set of files, I could run 1000 files through in 2.5 minutes.  So it's difficult
to predict how a particular job will perform, so consider these values relative to each other rather than as a guide to
how long things will take, or how much compression will be achieved.

Performance in the wild varies greatly based on machine specs, file contents, and configuration options.

FYI this module currently does a lot of synchronous operations and isn't intended to run in a live production
environment.  If there's interest to change that then that's something else that could be looked at.

See the *Dedupe options* section for a better understanding of the pressure points regarding balancing performance and
deduplication effectiveness, and some configuration ideas for striking the right balance for you.

## Tests

Tests are available in the github repo and can be executed with `npm test`.

To check coverage you have to install istanbul globally:
`npm install istanbul -g`
and then execute:
`npm run coverage`
A coverage summary will be displayed and a full coverage report will appear in the /coverage directory.

## Contributing

In lieu of a formal style guide, take care to maintain the existing coding style. Add mocha tests for coverage and explicitly test bugs.

