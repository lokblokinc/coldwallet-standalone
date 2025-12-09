const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
// const File = require('./file');
// const InitRecord = require('./initrecord');
// const StartRecoveryRecord = require('./startrecoveryrecord');
// const ToughboxAccount = require('./toughboxaccount');
// const Toughkey = require('./toughkey');
// const Role = require('./role');
// const UserRole = require('./userRole');

const Address = sequelize.define('Address', {
  id: {
    type: DataTypes.INTEGER,
    autoIncrement: true,
    primaryKey: true,
    allowNull: false,
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: true, 
  },
  address: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
  },
  partyGUID: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  asset: {
    type: DataTypes.STRING(10),
    allowNull: false,
    defaultValue: 'BTC',                  
    validate: { isIn: [['BTC','ETH','XRP']] }
  },
  createdAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
  updatedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
  },
},
{
  tableName: 'Addresses',
  timestamps: true
});

module.exports = Address;
