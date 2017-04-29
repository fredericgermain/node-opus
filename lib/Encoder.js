
var util = require( 'util' );
var Transform = require( 'stream' ).Transform;
var OpusEncoderStream = require( './OpusEncoderStream' );
var OpusFileOggStream = require( './OpusFileOggStream' );

// These are the valid rates for libopus according to
// https://www.opus-codec.org/docs/opus_api-1.1.2/group__opus__encoder.html#gaa89264fd93c9da70362a0c9b96b9ca88
var VALID_RATES = [ 8000, 12000, 16000, 24000, 48000 ];

// type: pcm or encoded
var Encoder = function( rate, channels, frameSize, params, type ) {
    Transform.call( this, { readableObjectMode: true } );

    var oggFileStream = new OpusFileOggStream(rate, channels, frameSize, params);

    if (type === undefined || type === 'pcm') {
      var encoderStream = new OpusEncoderStream(rate, channels, frameSize);

      encoderStream
        .pipe(oggFileStream);

      oggFileStream.on('data', function(chunk) {
        this.push(chunk);
      }.bind(this));
      oggFileStream.on('end', function(chunk) {
          if (this.flush_done === undefined) {
              throw new Error('strange state');
          }
          this.flush_done();
      }.bind(this));

      this.encoderStream = encoderStream;
    } else if (type === 'encoded'){
        return oggFileStream;
    } else {
        throw new Error('bad type');
    }
};
util.inherits( Encoder, Transform );

/**
 * Transform stream callback
 */
Encoder.prototype._transform = function( pcmbuf, encoding, done ) {
    this.encoderStream.write(pcmbuf);
    done();
};


/**
 * Transform stream callback
 */
Encoder.prototype._flush = function( done ) {
    this.encoderStream.end();
    this.flush_done = done;
};

Encoder.OpusEncoderStream = OpusEncoderStream;
Encoder.OpusFileOggStream = OpusFileOggStream;

module.exports = Encoder;
