var gulp = require('gulp');
var jsdoc = require('gulp-jsdoc3');
var uglify = require('gulp-uglify');
var rename = require('gulp-rename');
var saveLicense = require('uglify-save-license');
var del = require('del');
var concat = require('gulp-concat');

gulp.task('clean', function(done) {
	del('./dist');
	done();
});

gulp.task('js', function() {
	return gulp.src(['src/js/*.js'])
	.pipe(uglify({ie8:true}))
	.pipe(rename({suffix:'.min'}))
	.pipe(gulp.dest('./dist/js'));
});

gulp.task('docs', function(cb) {
	var config = require('./jsdoc.json');
	gulp.src(
		['readme.md', 'src/js/ddm.js'],
		{read: false}
	)
	.pipe(jsdoc(config, cb));
});

gulp.task('default', gulp.series('clean', 'js', 'docs'));

gulp.task('watch', function(){
	gulp.watch(['src/js/*.js','readme.md','jsdoc.json', 'src/tut/*'], gulp.series('default'));
});
