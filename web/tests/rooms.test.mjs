import test from 'node:test';
import assert from 'node:assert/strict';
import {RoomEngine} from '../src/features/office/domain/RoomEngine.ts';
import {LayoutEngine} from '../src/features/office/domain/LayoutEngine.ts';
const room={id:'eng',name:'Engineering',department:'Engineering',purpose:'Build',x:0,y:0,width:6,height:5,door_side:'south',door_offset:2};
test('walls force a route through the door instead of walking through boundaries',()=>{
 const e=new LayoutEngine([], [room]);const path=e.path({x:1,y:2},{x:9,y:2});assert.ok(path.length>1);
 assert.ok(path.some((p,n)=>n>0&&p.x===2&&p.y===5&&path[n-1].x===2&&path[n-1].y===4));
 for(let n=1;n<path.length;n++)assert.equal(RoomEngine.crosses(room,path[n-1],path[n]),false);
});
test('rotated furniture cannot straddle walls or block either side of doors',()=>{
 const e=new LayoutEngine([], [room]);assert.notEqual(e.validate({id:'x',kind:'desk',x:5,y:2,rotation:0}),'');
 assert.notEqual(e.validate({id:'x',kind:'chair',x:2,y:5,rotation:0}),'');assert.equal(e.validate({id:'x',kind:'desk',x:1,y:2,rotation:90}),'');
});
test('department assignment is deterministic and nearest goal stays in assigned room',()=>{
 const re=new RoomEngine([room]);assert.equal(re.assigned({department:' engineering '})?.id,'eng');assert.equal(re.assigned({department:'Design'}),undefined);
 const e=new LayoutEngine([], [room]);assert.ok(RoomEngine.contains(room,...Object.values(e.nearest({x:19,y:11},room))));
});
test('room spacing, duplicate department and boundary doors rejected',()=>{
 for(const rooms of [[room,{...room,id:'two',department:'Design',x:6}],[room,{...room,id:'two',x:8}],[{...room,door_side:'north'}]])assert.notEqual(new RoomEngine(rooms).validate([]),'');
 assert.equal(new RoomEngine([room,{...room,id:'two',department:'Design',x:8}]).validate([]),'');
});
test('explicit room overrides department and common mode stays outside department rooms',()=>{
 const e=new RoomEngine([room,{...room,id:'design',name:'Design',department:'Design',x:8}]);
 assert.equal(e.assigned({department:'Engineering',office_placement:'room',office_room_id:'design'})?.id,'design');
 assert.equal(e.assigned({department:'Engineering',office_placement:'common'}),undefined);
 assert.equal(e.assigned({department:'Engineering',office_placement:'auto'})?.id,'eng');
});
