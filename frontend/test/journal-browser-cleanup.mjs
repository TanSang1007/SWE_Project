import assert from 'node:assert/strict';
export async function keepJournalFixtures(database) {
  const schema=(await database.query('SELECT current_schema() AS schema')).rows[0].schema;
  if(!/^brewlite_(?:a0[34]|l01)_browser_[a-f0-9]{32}$/.test(schema))return false;
  assert.equal(schema,process.env.BROWSER_TEST_SCHEMA,'Only this run owns the cleanup target');
  return true;
}
