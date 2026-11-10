const test=require('node:test');
const assert=require('node:assert/strict');
const X=require('../sync/member-labels.js');
test('stored family alias displays as friendly name, never raw UID',()=>{
 const m={family_id:'f',user_uid:'person-technical-identifier-9423',member_role:'member',member_alias:'  老婆  '};
 assert.equal(X.displayName(m),'老婆');
 assert.equal(X.displayRole(m),'家庭成员');
 assert.doesNotMatch(X.displayName(m),/9423/);
});
test('existing member rows without alias show role instead of long ID',()=>{
 assert.equal(X.displayName({user_uid:'secret',member_role:'owner'}),'管理员');
 assert.equal(X.displayName({user_uid:'secret',member_role:'member'}),'家庭成员');
 assert.equal(X.normalizeAlias('  '),null);
});
test('alias supports Unicode and rejects control characters and oversized strings',()=>{
 assert.equal(X.normalizeAlias(' 宝宝妈妈 🌷 '),'宝宝妈妈 🌷');
 assert.throws(()=>X.normalizeAlias('a'.repeat(25)),/too_long/);
 assert.throws(()=>X.normalizeAlias('hello\nworld'),/control_char/);
 assert.throws(()=>X.normalizeAlias(42),/must_be_string/);
});
test('UI edit affordance only for owner or member self',()=>{
 const user={user_uid:'user-a',member_role:'member'};
 assert.equal(X.canEditAlias({selfUid:'owner',ownerUid:'owner',member:user}),true);
 assert.equal(X.canEditAlias({selfUid:'user-a',ownerUid:'owner',member:user}),true);
 assert.equal(X.canEditAlias({selfUid:'outsider',ownerUid:'owner',member:user}),false);
});
