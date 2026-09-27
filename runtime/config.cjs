'use strict';
const path=require('node:path');
const required=name=>{const value=process.env[name];if(!value)throw new Error(`Missing ${name}`);return value;};
module.exports={
  get botToken(){return required('BOT_TOKEN');},
  get adminPassword(){return required('ADMIN_PASSWORD');},
  get dataDir(){return path.resolve(required('BOT_DATA_DIR'));},
};
