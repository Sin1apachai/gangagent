import test from 'node:test';import assert from 'node:assert/strict';
import {RoomDraft} from '../src/features/office/domain/RoomDraft.ts';
import {RoomEngine} from '../src/features/office/domain/RoomEngine.ts';
const room={id:'eng',name:'Engineering',department:'Engineering',x:1,y:1,width:6,height:5,door_side:'south',door_offset:2};
test('dragging either direction creates the same inclusive rectangle',()=>{
 const a=RoomDraft.rectangle({x:1,y:1},{x:6,y:5},room),b=RoomDraft.rectangle({x:6,y:5},{x:1,y:1},room);assert.deepEqual(a,b);assert.equal(a.width,6);assert.equal(a.height,5);assert.equal(new RoomEngine([a]).validate([]),'');
});
test('moving and resizing preserve room identity and keep the opposite corner fixed',()=>{
 const moved=RoomDraft.move(room,{x:2,y:2},{x:4,y:5});assert.equal(moved.x,3);assert.equal(moved.y,4);assert.equal(moved.id,room.id);
 const resized=RoomDraft.resize(room,'nw',{x:0,y:0});assert.equal(resized.x,0);assert.equal(resized.width,7);assert.equal(resized.height,6);assert.equal(resized.x+resized.width,room.x+room.width);
});
test('wall clicks choose the proper door edge and interior clicks do not place doors',()=>{
 for(const [point,side,offset] of [[{x:3.2,y:1},'north',2],[{x:7,y:3.2},'east',2],[{x:3.2,y:6},'south',2],[{x:1,y:3.2},'west',2]]){const r=RoomDraft.door(room,point);assert.equal(r.door_side,side);assert.equal(r.door_offset,offset);}
 assert.equal(RoomDraft.door(room,{x:4,y:3}),null);
});
test('visual geometry still respects occupied doorways, map edges and room corridors',()=>{
 const r=RoomDraft.door(room,{x:3.2,y:6});const item={id:'blocked',kind:'chair',x:3,y:6,rotation:0};assert.notEqual(new RoomEngine([r]).validate([item]),'');
 assert.notEqual(new RoomEngine([RoomDraft.move(room,{x:1,y:1},{x:19,y:11})]).validate([]),'');
 assert.notEqual(new RoomEngine([RoomDraft.rectangle({x:1,y:1},{x:2,y:2},room)]).validate([]),'');
});
test('resize handles snap to the nearest boundary without floating-point off-by-one jumps',()=>{
 const a=RoomDraft.resizeBoundary(room,'se',{x:8-1e-12,y:7-1e-12});assert.equal(a.width,7);assert.equal(a.height,6);
 const unchanged=RoomDraft.resizeBoundary(room,'se',{x:7,y:6});assert.deepEqual(unchanged,room);
});
