
var util = require( 'util' );
var Transform = require( 'stream' ).Transform;
var ogg_packet = require( 'ogg-packet' );
var VorbisComments = require( './VorbisComments' );

// These are the valid rates for libopus according to
// https://www.opus-codec.org/docs/opus_api-1.1.2/group__opus__OpusFileWriterStream.html#gaa89264fd93c9da70362a0c9b96b9ca88
var VALID_RATES = [ 8000, 12000, 16000, 24000, 48000 ];

var OpusFileWriterStream = function( rate, channels, frameSize, params ) {
    Transform.call( this, { readableObjectMode: true } );

    this.rate = rate || 48000;

    // Ensure the range is valid.
    if( VALID_RATES.indexOf( this.rate ) === -1 ) {
        throw new RangeError(
                'OpusFileWriterStream rate (' + this.rate + ') is not valid. ' +
                'Valid rates are: ' + VALID_RATES.join( ', ' ) );
    }

    this.channels = channels || 1;
    this.frameSize = frameSize || this.rate * 0.04;

    this.frameOverflow = new Buffer(0);
    this.params = params || {};

    this.headerWritten = false;
    this.pos = 0;
    this.samplesWritten = 0;
};
util.inherits( OpusFileWriterStream, Transform );

/**
 * Transform stream callback
 */
OpusFileWriterStream.prototype._transform = function( buf, encoding, done ) {
    this._pushEncodedBuffer( buf );

    done();
};

function genOpusHead(channels, rate) {
  // OpusHead packet
  var magicSignature = new Buffer( 'OpusHead', 'ascii' );
  var data = new Buffer([
      0x01,  // version
      channels,
      0x00, 0x0f,  // Preskip (default and recommended 3840)
      ( ( rate & 0x000000ff ) >> 0 ),
      ( ( rate & 0x0000ff00 ) >> 8 ),
      ( ( rate & 0x00ff0000 ) >> 16 ),
      ( ( rate & 0xff000000 ) >> 24 ),
      0x00, 0x00,  // gain
      0x00,  // Channel mappign (RTP, mono/stereo)
  ]);

  return Buffer.concat([ magicSignature, data ]);
}

function genOpusTags(vendor, comments) {
    // OpusTags packet
    const opusTagsBuffers = [];
    magicSignature = new Buffer( 'OpusTags', 'ascii' );
    opusTagsBuffers.push(magicSignature);

    var vorbisComments = new VorbisComments(vendor, comments);
    vorbisComments.dump(opusTagsBuffers);
    opusTagsBuffers.push(new Buffer([ 0xff ]));
    //console.log(opusTagsBuffers, opusTagsBuffers.map((c)=>c.toString('utf8')));
    return new Buffer.concat(opusTagsBuffers);
}

OpusFileWriterStream.prototype._writeHeader = function() {
    var header = this.params.OpusHead || genOpusHead(this.channels, this.rate);

    var packet = new ogg_packet();
    packet.packet = header;
    packet.bytes = header.length;
    packet.b_o_s = 1;
    packet.e_o_s = 0;
    packet.granulepos = 0;
    packet.packetno = this.pos++;

    this.push( packet );
    this.samplesWritten += header.length;

    header = genOpusTags(
        this.params.vendor || 'node-opus',
        this.params.comments || []
    );

    packet = new ogg_packet();
    packet.packet = header;
    packet.bytes = header.length;
    packet.b_o_s = 0;
    packet.e_o_s = 0;
    packet.granulepos = this.samplesWritten;
    packet.packetno = this.pos++;
    packet.flush = true;

    this.push( packet );

    this.headerWritten = true;
};


OpusFileWriterStream.prototype._pushEncodedBuffer = function( encoded ) {
    // Write the header if it hasn't been written yet
    if( !this.headerWritten ) {
        this._writeHeader();
    }

    if( this.lastPacket ) {
        this.push( this.lastPacket );
    }

    if (encoded.frameSize)
        this.samplesWritten += encoded.frameSize;
    else
        this.samplesWritten += this.frameSize;

    var packet = new ogg_packet();
    packet.packet = encoded;
    packet.bytes = encoded.length,
    packet.b_o_s = 0;
    packet.e_o_s = 0;
    packet.granulepos = this.samplesWritten;
    packet.packetno = this.pos++;
    packet.flush = true;

    this.lastPacket = packet;
};

OpusFileWriterStream.prototype._flush = function( done ) {

    if( this.lastPacket ) {
        this.lastPacket.e_o_s = 1;
        this.push( this.lastPacket );
    }

    done();
};

module.exports = OpusFileWriterStream;
