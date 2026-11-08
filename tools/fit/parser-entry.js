// Build-only entry; dependency is bundled locally, not fetched by production browsers.
import FitParser from 'fit-file-parser';
export async function decode(bytes){
  if(!(bytes instanceof ArrayBuffer)||bytes.byteLength<14||bytes.byteLength>10*1024*1024)throw Error('FIT-файл должен быть размером до 10 МБ.');
  return new FitParser({force:false,strict:true,mode:'list',speedUnit:'m/s',lengthUnit:'m',temperatureUnit:'celsius'}).parseAsync(bytes);
}
