const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('../config/database');
const bcrypt = require('bcryptjs');

class User extends Model {
  isTokenExpired() {
    if (!this.tokenExpiresAt) return true;
    return new Date() >= this.tokenExpiresAt;
  }

  async updateTokens(accessToken, refreshToken, expiresIn) {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    this.tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
    return this.save();
  }

  toJSON() {
    const values = { ...this.get() };
    delete values.accessToken;
    delete values.refreshToken;
    delete values.tokenExpiresAt;
    delete values.password;
    return values;
  }

  async comparePassword(password) {
    if (!this.password) return false;
    return bcrypt.compare(password, this.password);
  }
}

User.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },

    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      validate: { isEmail: true },
      set(value) {
        this.setDataValue('email', value.toLowerCase().trim());
      },
    },

    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    password: {
      type: DataTypes.STRING,
      allowNull: true,
      set(value) {
        if (value) {
          const hash = bcrypt.hashSync(value, 10);
          this.setDataValue('password', hash);
        }
      },
    },

    autodeskId: {
      type: DataTypes.STRING,
      unique: true,
      allowNull: true,
    },

    accessToken: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    refreshToken: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    tokenExpiresAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },

    permissions: {
      type: DataTypes.ARRAY(DataTypes.STRING),
      defaultValue: ['read'],
    },

    preferences: {
      type: DataTypes.JSONB,
      defaultValue: {
        defaultHub: null,
        defaultProject: null,
        notificationEmail: true,
        theme: 'light',
      },
    },

    lastLogin: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },

    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
  },
  {
    sequelize,
    modelName: 'User',
    tableName: 'users',
    timestamps: true,
    indexes: [{ fields: ['email'] }, { fields: ['autodeskId'] }],
  }
);

module.exports = User;

