// Central test environment configuration
const path = require('path');

const API_BASE_URL = process.env.TEST_API_URL || 'http://localhost:5000';
const DB_CONNECTION_STRING = process.env.DB_CONNECTION_STRING || 
    'Driver={ODBC Driver 17 for SQL Server};Server=localhost;Database=CarModelStoreDB;Trusted_Connection=yes;';

module.exports = {
    API_BASE_URL,
    DB_CONNECTION_STRING,
    BACKEND_DIR: path.resolve(__dirname, '../../car-store-backend')
};
