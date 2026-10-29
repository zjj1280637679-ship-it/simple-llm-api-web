/** Bounded PNG structural/CRC/zlib validation; no network and no image quality claim. */
import {inflateSync} from 'node:zlib';
const invalid=()=>{throw new Error('INVALID_PNG');};
const crc32=data=>{let crc=0xffffffff;for(const byte of data){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;};
export function inspectPng(input,{maxBytes=16777216,maxPixels=16777216,maxDimension=8192}={}) {
  const bytes=Buffer.from(input);if(bytes.length>maxBytes||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')invalid();
  let offset=8,header,end=false,dataEnded=false,seenData=false,palette=false;const compressed=[];
  while(offset<bytes.length) {
    if(offset+12>bytes.length)invalid();
    const length=bytes.readUInt32BE(offset),type=bytes.subarray(offset+4,offset+8).toString('ascii'),last=offset+12+length;
    if(last>bytes.length||!/^[A-Za-z]{4}$/.test(type)||crc32(bytes.subarray(offset+4,last-4))!==bytes.readUInt32BE(last-4))invalid();
    const data=bytes.subarray(offset+8,last-4);
    if(!header) {
      if(type!=='IHDR'||length!==13)invalid();
      const width=data.readUInt32BE(0),height=data.readUInt32BE(4),bitDepth=data[8],colorType=data[9];
      const depths={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
      if(!width||!height||width>maxDimension||height>maxDimension||width*height>maxPixels||!depths[colorType]?.includes(bitDepth)||data[10]||data[11]||data[12])invalid();
      header={width,height,bitDepth,colorType,interlaced:false};
    } else if(type==='IHDR')invalid();
    else if(type==='PLTE') {if(seenData||palette||!length||length%3||length>768)invalid();palette=true;}
    else if(type==='IDAT') {if(dataEnded||(header.colorType===3&&!palette))invalid();seenData=true;compressed.push(data);}
    else if(type==='IEND') {if(length||last!==bytes.length||!seenData)invalid();end=true;}
    else {if(type[0]===type[0].toUpperCase())invalid();if(seenData)dataEnded=true;}
    offset=last;
  }
  if(!header||!end)invalid();
  const channels={0:1,2:3,3:1,4:2,6:4}[header.colorType],stride=Math.ceil(header.width*channels*header.bitDepth/8)+1,expected=stride*header.height;
  let raw;try{raw=inflateSync(Buffer.concat(compressed),{maxOutputLength:expected});}catch{invalid();}
  if(raw.length!==expected)invalid();for(let row=0;row<header.height;row++)if(raw[row*stride]>4)invalid();
  return {...header,bytes:bytes.length,decodedBytes:raw.length,validation:'complete-chunks-crc-zlib-noninterlaced'};
}
