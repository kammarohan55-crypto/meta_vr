import {build} from 'esbuild';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const project=fileURLToPath(new URL('../',import.meta.url));
const threeModule=join(project,'node_modules','three','build','three.module.js');
const scratch=mkdtempSync(join(tmpdir(),'afterhours-hands-'));
const bundle=join(scratch,'tabletop.mjs');
process.once('exit',()=>rmSync(scratch,{recursive:true,force:true}));
// Exercise the actual interaction methods with the same Three math library,
// without starting a renderer or substituting copies of the interaction logic.
await build({entryPoints:[join(project,'src','game','tabletop.ts')],outfile:bundle,bundle:true,platform:'node',format:'esm',logLevel:'silent',plugins:[{name:'core-math',setup(b){b.onResolve({filter:/^@iwsdk\/core$/},()=>({path:'core',namespace:'check'}));b.onLoad({filter:/.*/,namespace:'check'},()=>({contents:`export * from ${JSON.stringify(threeModule.replaceAll('\\','/'))}; export const AssetManager={};`,resolveDir:project}));}}]});
const {Tabletop,PILE}=await import(pathToFileURL(bundle).href);
const {Group,Vector3,Quaternion}=await import(pathToFileURL(threeModule).href);
let checks=0;
const expect=(fn)=>{fn();checks++};
function setup(){
 const t=Object.create(Tabletop.prototype);
 let plays=0,draws=0,nopes=0;
 Object.assign(t,{hand:new Map(),flights:[],near:{left:-1,right:-1},drag:null,hoverId:-1,time:0,lastDirect:-1e9,drawTop:{visible:false},dropMat:{opacity:0,color:{setHex(){}}},listener:{play(){plays++},draw(){draws++},nope(){nopes++},sound(){}},view:{phase:'play',seat:0,current:0,hasDrawn:false,playable:[1,2]},fanTilt:-.42});
 return {t,counts:()=>({plays,draws,nopes})};
}
function card(id,pos=new Vector3(0,1,.68)) {const root=new Group();root.position.copy(pos);return {mesh:{material:{}},card:{id,color:0,kind:'num',value:4},root,home:pos.clone(),homeQ:new Quaternion(),pending:false,dragging:false,playable:true,lift:0};}
const idle={pos:null,pinching:false,started:false,ended:false};
const holding=pos=>({pos,pinching:true,started:false,ended:false});
{
 const {t}=setup();const a=card(1);a.root.quaternion.setFromAxisAngle(new Vector3(0,0,1),.3);t.hand.set(1,a);
 const tip=new Vector3(.032,.048,.01).applyQuaternion(a.root.quaternion).add(a.root.position);
 expect(()=>assert.equal(t.nearestCard(tip),1));
 expect(()=>assert.equal(t.nearestCard(new Vector3(.2,1,.68)),-1));
}
{
 const {t}=setup();const back=card(1),front=card(2,new Vector3(0,1,.684));t.hand.set(1,back);t.hand.set(2,front);
 expect(()=>assert.equal(t.nearestCard(new Vector3(0,1,.7)),2));
}
{
 const {t}=setup();const a=card(1,new Vector3(-.1,1,.68)),b=card(2,new Vector3(.1,1,.68));t.hand.set(1,a);t.hand.set(2,b);
 t.updateHand(1/72,{left:{...holding(a.root.position.clone()),started:true},right:{...holding(b.root.position.clone()),started:true}});
 expect(()=>assert.equal(t.drag.hc.card.id,1));
}
{
 const {t,counts}=setup();const a=card(1);t.hand.set(1,a);const tip=a.root.position.clone().add(new Vector3(.025,.035,.012));t.drag=t.beginDrag(a,'right',tip,null);a.dragging=true;
 t.updateHand(1/72,{left:idle,right:holding(tip)});
 expect(()=>assert.ok(a.root.position.distanceTo(a.home)<1e-9,'pinch offset must not snap card centre'));
 t.updateHand(1/72,{left:idle,right:idle});
 expect(()=>assert.equal(t.drag,null));expect(()=>assert.deepEqual(counts(),{plays:0,draws:0,nopes:0}));
}
{
 const {t,counts}=setup();const a=card(1);t.hand.set(1,a);const tip=a.root.position.clone();t.drag=t.beginDrag(a,'right',tip,null);a.dragging=true;
 t.updateHand(1/72,{left:idle,right:holding(tip.clone().add(new Vector3(.3,0,0)))});
 expect(()=>assert.equal(t.drag,null));expect(()=>assert.equal(counts().plays,0));
}
{
 const {t,counts}=setup();const g=new Group();let d=t.beginDrag(null,'right',new Vector3(0,1,0),g);d.age=.3;d.travel=.15;t.release(d,new Vector3(.15,1,0));
 expect(()=>assert.equal(counts().draws,0,'sideways brushing must not draw'));
 d=t.beginDrag(null,'right',new Vector3(0,1,0),g);d.age=.3;d.travel=.12;t.release(d,new Vector3(0,1,.12));
 expect(()=>assert.equal(counts().draws,1,'intentional pull must draw'));
}
{
 const {t,counts}=setup();const a=card(1,PILE.clone().add(new Vector3(0,.02,0)));t.hand.set(1,a);t.release(t.beginDrag(a,'right',a.root.position.clone(),null),a.root.position);
 expect(()=>assert.equal(counts().plays,1,'valid release over pile must play'));
 expect(()=>assert.equal(t.inPlayZone(PILE.clone().add(new Vector3(0,-.5,0))),false));
}
{
 // Seated reach: a card pushed 13 cm out of the fan toward the pile plays on release, a metre short of the pile.
 const {t,counts}=setup();const a=card(1);t.hand.set(1,a);const d=t.beginDrag(a,'right',a.root.position.clone(),null);
 a.root.position.add(new Vector3(0,.02,-.13));t.release(d,a.root.position);
 expect(()=>assert.equal(counts().plays,1,'a forward push must play'));
}
// Lifting a card to look at it, pulling it toward you or sliding it sideways must not play it.
for(const move of [new Vector3(0,.15,0),new Vector3(0,0,.13),new Vector3(.14,0,0)]){
 const {t,counts}=setup();const a=card(1);t.hand.set(1,a);const d=t.beginDrag(a,'right',a.root.position.clone(),null);
 a.root.position.add(move);t.release(d,a.root.position);
 expect(()=>assert.equal(counts().plays,0,'only a forward push plays'));
}
console.log(`${checks} interaction assertions passed: corners, overlap, separate hands, stable contact, tracking loss, pose jumps, deliberate deck pull, discard release, forward push and height bounds.`);
