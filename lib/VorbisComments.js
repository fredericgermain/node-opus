
var VorbisComments = function( vendor, comments ) {
    this.vendor = vendor || "";
    this.comments = comments || [];
}

VorbisComments.prototype.dump = function( acc ) {
    var vendor = new Buffer(this.vendor, 'utf8' );
    var vendorLength = new Buffer( 4 );
    vendorLength.writeUInt32LE( vendor.length, 0 );
    acc.push(vendorLength);
    acc.push(vendor);

    const comments = this.comments.filter(function ([key, value]) {
        return value !== undefined;
    });
    var commentsLength = new Buffer( 4 );
    commentsLength.writeUInt32LE(comments.length, 0 );
    acc.push(commentsLength);
    comments.reduce((acc2, [key, value]) => {
        var commentData = Buffer.from(key+"="+value, 'utf8');
        var commentLength = new Buffer( 4 );
        commentLength.writeUInt32LE( commentData.length, 0 );
        acc2.push(commentLength);
        acc2.push(commentData);
        return acc2;
    }, acc);
}

module.exports = VorbisComments;
