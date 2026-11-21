'use strict';
const {execFileSync}=require('node:child_process');
const path=require('node:path');

// The last V1.1.2 root shell before the frontend release moved to V1.2.0.
const SHA='a7c6a138f8aa7858b6b72b8f843625a5a4232bd9';
function readLegacy(file){
 return execFileSync('git',['show',SHA+':'+file],{
  cwd:path.resolve(__dirname,'../..'),encoding:'utf8'
 });
}

module.exports={readLegacy};
