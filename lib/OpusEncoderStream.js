
var util = require( 'util' );
var Transform = require( 'stream' ).Transform;
var OpusEncoder = require( './OpusEncoder' );

// These are the valid rates for libopus according to
// https://www.opus-codec.org/docs/opus_api-1.1.2/group__opus__OpusEncoderStream.html#gaa89264fd93c9da70362a0c9b96b9ca88
var VALID_RATES = [ 8000, 12000, 16000, 24000, 48000 ];

var OpusEncoderStream = function( rate, channels, frameSize ) {
    Transform.call( this );

    this.rate = rate || 48000;

    // Ensure the range is valid.
    if( VALID_RATES.indexOf( this.rate ) === -1 ) {
        throw new RangeError(
                'OpusEncoderStream rate (' + this.rate + ') is not valid. ' +
                'Valid rates are: ' + VALID_RATES.join( ', ' ) );
    }

    this.channels = channels || 1;
    this.frameSize = frameSize || this.rate * 0.04;

    this.OpusEncoderStream = new OpusEncoder( this.rate, this.channels );
    this.frameOverflow = new Buffer(0);

    this.pos = 0;
    this.samplesWritten = 0;

    return this;
};
util.inherits( OpusEncoderStream, Transform );

/**
 * Transform stream callback
 */
OpusEncoderStream.prototype._transform = function( buf, encoding, done ) {
	// Transform the buffer
    this._processOutput( buf );

    done();
};

OpusEncoderStream.prototype._processOutput = function( buf ) {

	// Calculate the total data available and data required for each frame.
    var totalData = buf.length + this.frameOverflow.length;
    var requiredData = this.frameSize * 2 * this.channels;

	// Process output while we got enough for a frame.
    while( totalData >= requiredData ) {

		// If we got overflow, use it up first.
        var buffer;
        if( this.frameOverflow ) {

            buffer = Buffer.concat([
                this.frameOverflow,
                buf.slice( 0, requiredData - this.frameOverflow.length )
            ]);

			// Cut the already used part off the buf.
            buf = buf.slice( requiredData - this.frameOverflow.length );

			// Remove overflow. We'll set it later so it'll never be null
			// outside of this function.
            this.frameOverflow = null;

        } else {

			// We got no overflow.
			// Just cut the required bits from the buffer
            buffer = buf.slice( 0, requiredData );
            buf = buf.slice( requiredData );
        }

		// Flush frame and remove bits from the total data counter before
		// repeating loop.
        this._flushFrame( buffer, this.frameSize );
        totalData -= requiredData;
    }

	// Store the remainign buffer in the overflow.
    this.frameOverflow = buf;
};

OpusEncoderStream.prototype._flushFrame = function( frame, frameSize ) {
    var encoded = this.OpusEncoderStream.encode( frame );
    encoded.frameSize = frameSize;
    this.push(encoded);
};

OpusEncoderStream.prototype._flush = function( done ) {
    if (this.frameOverflow.length) {
      var requiredData = this.frameSize * 2 * this.channels;
      const lastBuffer = this._flushFrame(Buffer.concat([
        this.frameOverflow,
        Buffer.alloc(requiredData-this.frameOverflow.length, 0)
      ]),
      this.frameOverflow.length/(2 * this.channels));
    }

    done();
};

module.exports = OpusEncoderStream;
