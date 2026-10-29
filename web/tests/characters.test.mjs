import test from 'node:test';
import assert from 'node:assert/strict';
import {characters,characterPixels,drawCharacter} from '../src/features/office/characters.ts';
test('all twelve choices have distinct pixels and fit the sprite bounds',()=>{
 assert.equal(characters.length,12);
 const signatures=new Set();
 for(const ch of characters){const pixels=characterPixels(ch.id);signatures.add(JSON.stringify(pixels));assert.ok(pixels.length>50);for(const p of pixels){assert.ok(p.x>=0&&p.x<16);assert.ok(p.y>=0&&p.y<20);assert.match(p.color,/^#[0-9a-f]{6}$/i);}}
 assert.equal(signatures.size,12);
});
test('walking frames animate without escaping the canvas cell',()=>{
 for(const ch of characters){const signatures=new Set();for(let frame=0;frame<3;frame++){const pixels=characterPixels(ch.id,frame);signatures.add(JSON.stringify(pixels));assert.ok(pixels.every(p=>p.x>=0&&p.x<16&&p.y>=0&&p.y<20));}assert.equal(signatures.size,3);}
});
test('Office drawing uses the selected portrait and safe fallback',()=>{
 assert.deepEqual(characterPixels(999),characterPixels(0));
 const drawn=[];const canvas={fillStyle:'',fillRect(x,y,w,h){drawn.push({x,y,w,h,color:this.fillStyle});}};
 drawCharacter(canvas,{},100,100,11,0,0);
 assert.ok(drawn.every(p=>p.x>=100&&p.x<132&&p.y>=90&&p.y<130&&p.w===2&&p.h===2));
 assert.ok(drawn.some(p=>p.color==='#9f684d'));
 assert.ok(drawn.some(p=>p.color==='#26394b'));
});
