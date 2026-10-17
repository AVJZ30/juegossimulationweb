// Tests the actual bridge class, not a duplicate implementation. No emulation claim.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../ps2.html'),'utf8');
const deviceSource=source.slice(source.indexOf('  class DiscImageDevice'),source.indexOf('\n  function mkdirp'));
function setup() {
  const errors=[], stats={reads:0,bytes:0};
  const context=vm.createContext({Uint8Array,performance,stats,stopped:false,failed:false,log:()=>{},fail:e=>errors.push(e)});
  const Device=vm.runInContext(deviceSource+'\nDiscImageDevice',context);
  const module={HEAPU8:new Uint8Array(64)};
  return {device:new Device(module),module,stats,errors};
}
const settle=()=>new Promise(r=>setImmediate(r));
test('reads a small slice above 4 GiB without allocating the whole ISO',async()=>{
  const {device,module,stats}=setup(); let requested;
  device.setFile({size:6*2**30,slice:(start,end)=>{requested=[start,end];return new Blob([new Uint8Array([1,2,3,4])]);}});
  device.read(8,2**32+2048,4);
  assert.equal(device.isDone(),false); await settle();
  assert.deepEqual(requested,[2**32+2048,2**32+2052]);
  assert.deepEqual([...module.HEAPU8.slice(8,12)],[1,2,3,4]);
  assert.equal(device.getFileSize(),6*2**30); assert.equal(stats.bytes,4); assert.equal(device.isDone(),true);
});
test('uses the refreshed heap after asynchronous disk read / WASM memory growth',async()=>{
  const {device,module}=setup(); let finish;
  device.setFile({size:4,slice:()=>({arrayBuffer:()=>new Promise(r=>finish=r)})});
  const old=module.HEAPU8; device.read(4,0,4); module.HEAPU8=new Uint8Array(128);
  finish(new Uint8Array([8,7,6,5]).buffer); await settle();
  assert.deepEqual([...module.HEAPU8.slice(4,8)],[8,7,6,5]); assert.equal(old[4],0);
});
test('failed local read releases isDone and reports failure instead of polling forever',async()=>{
  const {device,errors}=setup();
  device.setFile({size:4,slice:()=>({arrayBuffer:()=>Promise.reject(Error('unavailable'))})});
  device.read(0,0,4); await settle(); assert.equal(device.isDone(),true); assert.equal(errors.length,1);
});
test('rejects out-of-range and short reads',async()=>{
  const {device,errors}=setup(); device.setFile(new Blob([new Uint8Array(4)]));
  device.read(0,4,4); assert.equal(device.isDone(),true); assert.equal(errors.length,1);
  device.setFile({size:4,slice:()=>new Blob([new Uint8Array(2)])});
  device.read(0,0,4); await settle(); assert.equal(errors.length,2); assert.equal(device.isDone(),true);
});
test('discovers native card folders, persists an interior-byte change and file deletion',async()=>{
  const path=require('node:path'),os=require('node:os');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ps2-cards-'));
  const root='/home/web_user/.local/share/Play Data Files/vfs/mc0';
  const physical=p=>path.join(dir,p);
  const saves=[];
  try {
    fs.mkdirSync(physical(root),{recursive:true});
    fs.writeFileSync(physical(root+'/save'),Buffer.alloc(1000));
    const FS={readdir:p=>fs.readdirSync(physical(p)),lstat:p=>fs.lstatSync(physical(p)),isDir:mode=>(mode&0o170000)===0o040000,isFile:mode=>(mode&0o170000)===0o100000,readFile:p=>fs.readFileSync(physical(p))};
    const context=vm.createContext({Mod:{FS},Uint8Array,failed:false,lastSave:null,saveQueue:Promise.resolve(),hooks:{onMemcards:files=>saves.push(files)},log:()=>{}});
    const code=source.slice(source.indexOf('  function cardRoots'),source.indexOf('  // Native bindings'));
    vm.runInContext(code,context);
    await vm.runInContext('persistCards()',context);
    assert.equal(saves[0][0].path,root+'/save');
    const changed=Buffer.alloc(1000);changed[1]=9;fs.writeFileSync(physical(root+'/save'),changed);
    await vm.runInContext('persistCards()',context);
    assert.equal(saves[1][0].data[1],9);
    fs.unlinkSync(physical(root+'/save'));
    await vm.runInContext('persistCards()',context);
    assert.equal(saves[2].length,0);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
