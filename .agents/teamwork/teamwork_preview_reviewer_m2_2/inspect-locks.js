const db = require('../../../test/helpers/db');

async function main() {
  try {
    const res = await db.query(`
      SELECT 
        tl.request_session_id,
        tl.resource_type,
        tl.resource_description,
        tl.request_mode,
        tl.request_status,
        es.program_name,
        es.login_time,
        es.status
      FROM sys.dm_tran_locks tl
      JOIN sys.dm_exec_sessions es ON tl.request_session_id = es.session_id
      WHERE tl.resource_database_id = DB_ID('CarModelStoreDB')
    `);
    console.log('Locks count:', res.recordset.length);
    console.log('Locks:', res.recordset);

    const openTrans = await db.query(`
      SELECT 
        tat.transaction_id,
        tat.name,
        tat.transaction_begin_time,
        tat.transaction_state,
        ast.session_id
      FROM sys.dm_tran_active_transactions tat
      LEFT JOIN sys.dm_tran_session_transactions ast ON tat.transaction_id = ast.transaction_id
    `);
    console.log('Active transactions:', openTrans.recordset);
  } catch (e) {
    console.error('Error:', e);
  } finally {
    await db.close();
  }
}

main();
