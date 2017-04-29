
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
    
    this.channels = channels || 1;
    this.frameSize = frameSize || this.rate * 0.04;

    this.encoder = new OpusEncoder( this.rate, this.channels );
    this.frameOverflow = Buffer.alloc(0);
    this.params = params || {};

    this.headerWritten = false;
    this.pos = 0;
    this.granulepos = 0;
    this.samplesWritten = 0;
};
util.inherits( Encoder, Transform );

/**
 * Transform stream callback
 */
Encoder.prototype._transform = function( pcmbuf, encoding, done ) {
    this.encoderStream.write(pcmbuf);
    done();
};

Encoder.prototype._writeHeader = function() {

	// OpusHead packet
    var magicSignature = Buffer.from( 'OpusHead', 'ascii' );
    var data = this.params.OpusHead || Buffer.from([
        0x01,  // version
        this.channels,
        0x00, 0x0f,  // Preskip (default and recommended 3840)
        ( ( this.rate & 0x000000ff ) >> 0 ),
        ( ( this.rate & 0x0000ff00 ) >> 8 ),
        ( ( this.rate & 0x00ff0000 ) >> 16 ),
        ( ( this.rate & 0xff000000 ) >> 24 ),
        0x00, 0x00,  // gain
        0x00,  // Channel mappign (RTP, mono/stereo)
    ]);

    var header = Buffer.concat([ magicSignature, data ]);


    var packet = new ogg_packet();
    packet.packet = header;
    packet.bytes = header.length;
    packet.b_o_s = 1;
    packet.e_o_s = 0;
    packet.granulepos = -1;
    packet.packetno = this.pos++;

    this.push( packet );

	// OpusTags packet
    const OpusTagsBuffers = [];
    magicSignature = Buffer.from( 'OpusTags', 'ascii' );
    OpusTagsBuffers.push(magicSignature);

    var vendor = Buffer.from( this.params.vendor || 'node-opus', 'ascii' );
    var vendorLength = Buffer.alloc( 4 );
    vendorLength.writeUInt32LE( vendor.length, 0 );
    OpusTagsBuffers.push(vendorLength);
    OpusTagsBuffers.push(vendor);

    const comments = this.params.comments || {}
    var commentsLength = Buffer.alloc( 4 );
    commentsLength.writeUInt32LE(Object.keys(comments).length, 0 );
    OpusTagsBuffers.push(commentsLength);
    const commentBuffers = Object.keys(comments).reduce((acc, v) => {
          var commentData = Buffer.from(v+"="+comments[v], 'utf8');
          var commentLength = Buffer.alloc( 4 );
          commentLength.writeUInt32LE( commentData.length, 0 );
          acc.push(commentLength);
          acc.push(commentData);
          return acc;
    }, OpusTagsBuffers);
    OpusTagsBuffers.push(Buffer.from([ 0xff ]));
    header = Buffer.concat(OpusTagsBuffers);

    packet = new ogg_packet();
    packet.packet = header;
    packet.bytes = header.length;
    packet.b_o_s = 0;
    packet.e_o_s = 0;
    packet.granulepos = -1;
    packet.packetno = this.pos++;
    packet.flush = true;

    this.push( packet );

    this.headerWritten = true;
};

Encoder.prototype._processOutput = function( buf ) {

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
        this._flushFrame( buffer );
        totalData -= requiredData;
    }

	// Store the remainign buffer in the overflow.
    this.frameOverflow = buf;
};

Encoder.prototype._flushFrame = function( frame, end ) {
    var encoded = this.encoder.encode( frame );
    this._pushEncodedBuffer(encoded, end);
};

Encoder.prototype._pushEncodedBuffer = function( encoded, end ) {
    // Write the header if it hasn't been written yet
    if( !this.headerWritten ) {
        this._writeHeader();
    }
  
    if( this.lastPacket ) {
        this.push( this.lastPacket );
    }

    // Scale the frame size into 48 kHz bitrate, which is used for the
    // granule positioning. We'll still update the samplesWritten just to
    // ensure backwards compatibility.
    this.granulepos += this.frameSize / this.rate * 48000;
    this.samplesWritten += this.frameSize;

    var packet = new ogg_packet();
    packet.packet = encoded;
    packet.bytes = encoded.length,
    packet.b_o_s = 0;
    packet.e_o_s = 0;
    packet.granulepos = this.granulepos;
    packet.packetno = this.pos++;
    packet.flush = true;

    this.lastPacket = packet;
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
