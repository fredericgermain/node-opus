var stream = require('stream');
const ogg = require( 'ogg' );
const Encoder = require('./Encoder');
const debug = require('debug')('opus:converter');

function convertToOpusFileStream(sourceStream, options) {
  const oggEncoder = new ogg.Encoder();
  const {webmToOpus, serial, vendor, comments} = options;

  debug('start', webmStream);

  if (webmToOpus) {
    // https://www.matroska.org/technical/specs/index.html
    // same as mkvextract tracks test.webm 0:test.opus
    // could use mkvtoolnix, ffmpeg:
    // https://superuser.com/questions/412890/lossless-extraction-of-streams-from-webm
    // mkvtoolnix
    // ffmpeg -i "input.webm" -vn -acodec copy "output.oga"
    var webmStream = sourceStream;
    const ebml = require('ebml')
    const ebmlBlock = require('ebml-block')

    const decoder = new ebml.Decoder();

    const trans = webmStream
      .pipe(decoder)
      .pipe(new stream.Transform({
        constructor: function() {
            // not called using this simple constructor...
        },

        transform: function(chunk, encoding, callback) {
          //console.log(chunk);
          // https://wiki.xiph.org/MatroskaOpus
          // Found value in a quite random stream
          // CodecID A_OPUS
          // TrackNumber -> 1
          // CodecDelay -> 0x632ea0 -> 6500000ns
          // SeekPreRoll -> 80000000 (it should be in CodecPrivate too)
          // Channels nb channels
          // SamplingFrequency  -> 0x473b800 -> 48000Hz ?
          // CodecPrivate -> OpusHead
          // DiscardPadding 0x4f27ac -> 5187500ns : TODO: time to discard at end of stream
          if (chunk[0] === 'tag') {
            if (chunk[1].name === 'CodecPrivate') {
              this.codecPrivate = chunk[1].data; // "OpusHead"xxxx
            } else if (chunk[1].name === 'Channels') {
            //  console.log('Channels', chunk[1].data[0])
              this.channels = chunk[1].data.readUInt8(0);
            } else if ((chunk[1].name === 'Block' || chunk[1].name === 'SimpleBlock')) {
              if (this.opusFeed === undefined) {
                // a 10s cluster is made of 50 SimpleBlock -> (20ms) -> 10*48000 / 50 = 960
                // TODO: make it an option/cumpute it with #SimpleBlock in cluster/decode first frame ?
                this.frameSize = 960;

                // we start receive data, header end
                // create opusStream with infos from webm
                const oggStream = oggEncoder.stream(serial);
                const opusEncoder = new Encoder(48000, this.channels, this.frameSize, {
                  OpusHead: this.codecPrivate,
                  vendor,
                  comments
                },
                'encoded');
                const opusFeed = new stream.PassThrough();

                opusFeed
                  .pipe(opusEncoder)
                  .pipe( oggStream );

                this.opusFeed = opusFeed;
              }
              var webmTransform = this;
              var block = ebmlBlock(chunk[1].data)
              var encoded = block.frames[0];
              if (this.lastEncoded) {
                  this.lastEncoded.frameSize = this.frameSize;
                  this.opusFeed.write(this.lastEncoded);
              }
              this.lastEncoded = encoded;
            } else if (chunk[1].name === 'DiscardPadding') {
                const padding = chunk[1].data.readUIntBE(0, chunk[1].data.length);
                const nbSampleDiscard = padding * 48000 / 1000000000;
                //console.log('DiscardPadding', chunk[1].data, padding, nbSampleDiscard , 71.0 / 48000);
                if (this.lastEncoded) {
                    this.lastEncoded.frameSize = this.frameSize - nbSampleDiscard;
                    this.opusFeed.write(this.lastEncoded);
                    delete this.lastEncoded;
                }
            }
          } else if (chunk[0] === 'end' && (chunk[1].name === 'Segment')) {
            // last block received
            // hopefully webm have only one segment
            this.opusFeed.end()
          }
          callback();
        },
        writableObjectMode: true,
      }));

      /*
      [ 'end', 'finish', 'close' ].forEach((evt)=>{opusFeed.on(evt, () => { console.log('opusFeed', evt); })});
      [ 'end', 'finish', 'close' ].forEach((evt)=>{decoder.on(evt, () => { console.log('webm decoder', evt); })});
      [ 'end', 'finish', 'close' ].forEach((evt)=>{trans.on(evt, () => { console.log('webm trans', evt); })});
      [ 'end', 'finish', 'close' ].forEach((evt)=>{oggStream.on(evt, () => { console.log('ogg stream', evt); })});
      [ 'end', 'finish', 'close' ].forEach((evt)=>{oggEncoder.on(evt, () => { console.log('ogg container', evt); })});
      */
    } else {
        const spawn = require('child_process').spawn;
        const ffmpeg = spawn('ffmpeg', [
          '-i', 'pipe:0',
          '-f', 's16le',
          '-acodec', 'pcm_s16le',
          '-af', 'aresample=resampler=soxr', // http://www.transcoding.dk/2011/11/16/careful-with-audio-resampling-using-ffmpeg/
          '-ar', '48000',
          'pipe:1']);
        // gst-launch-1.0 filesrc "location=myfile.pcm" ! "audio/x-raw,format=S16LE,rate=48000,channels=2,layout=interleaved" ! pulsesink
        ffmpeg.stderr.on('data', (log) => {
          // maybe extract input file sampling rate
          // Stream #0:0(und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 6 kb/s (default)
          //console.log(`ffmpeg: ${log}`);
        });

        ffmpeg.on('close', (code) => {
          //console.log(`ffmpeg child process exited with code ${code}`);
        });

        const oggStream = oggEncoder.stream(serial);
        // a 10s cluster is made of 50 SimpleBlock -> (20ms) -> 10*48000 / 50 = 960
        const opusEncoder = new Encoder(48000, 2, undefined, {
          vendor,
          comments,
        },
        'pcm');

        sourceStream
          .pipe(ffmpeg.stdin);
        ffmpeg.stdout
          .pipe( opusEncoder )
          .pipe( oggStream );

        /*
        [ 'end', 'finish', 'close' ].forEach((evt)=>{ffmpeg.stdout.on(evt, () => { console.log('ffmpeg.stdout', evt); })});
        [ 'end', 'finish', 'close' ].forEach((evt)=>{opusEncoder.on(evt, () => { console.log('opusEncoder', evt); })});
        [ 'end', 'finish', 'close' ].forEach((evt)=>{oggStream.on(evt, () => { console.log('oggStream', evt); })});
        */
        //ffmpeg.stdout
        //  .pipe(fs.createWriteStream((filename || selected_video.title) + ' [yt:' +selected_video.id + '].pcm'))
    }


    //[ 'end', 'finish', 'close' ].forEach((evt)=>{sourceStream.on(evt, () => { console.log('sourceStream', evt); })});


    return oggEncoder;
}

module.exports = {
    convertToOpusFileStream,
}
