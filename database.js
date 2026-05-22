const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');

const DB_PATH = path.join(__dirname, 'demandas.db');

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: DB_PATH,
  logging: false, // Desativa logs de SQL no console para manter limpo
  define: {
    timestamps: false // Vamos gerenciar created_at manualmente ou deixar default
  }
});

// 1. Modelo de Usuários
const User = sequelize.define('User', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  username: { type: DataTypes.STRING, unique: true, allowNull: false },
  password: { type: DataTypes.STRING, allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false },
  role: { type: DataTypes.STRING, allowNull: false }
}, { tableName: 'users' });

// 2. Modelo de Pacientes
const Patient = sequelize.define('Patient', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING, allowNull: false },
  cpf: { type: DataTypes.STRING, unique: true, allowNull: true },
  cns: { type: DataTypes.STRING, allowNull: true },
  mother_name: { type: DataTypes.STRING, allowNull: true },
  birth_date: { type: DataTypes.STRING, allowNull: true },
  created_at: { type: DataTypes.DATE, defaultValue: Sequelize.NOW }
}, { tableName: 'patients' });

// 3. Modelo de Demandas Judiciais
const Demand = sequelize.define('Demand', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  process_number: { type: DataTypes.STRING, allowNull: false },
  prodata_number: { type: DataTypes.STRING, allowNull: true },
  patient_id: { type: DataTypes.INTEGER, allowNull: false },
  title: { type: DataTypes.STRING, allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  judge: { type: DataTypes.STRING, allowNull: true },
  received_at: { type: DataTypes.STRING, allowNull: false }, // Formato: YYYY-MM-DD HH:MM:SS
  deadline: { type: DataTypes.STRING, allowNull: false }, // Formato: YYYY-MM-DD HH:MM:SS
  status: { 
    type: DataTypes.STRING, 
    allowNull: false,
    validate: {
      isIn: [['Pendente', 'Em Andamento', 'Concluído', 'Atrasado']]
    }
  },
  creator_id: { type: DataTypes.INTEGER, allowNull: false },
  current_user_id: { type: DataTypes.INTEGER, allowNull: false },
  created_at: { type: DataTypes.DATE, defaultValue: Sequelize.NOW },
  updated_at: { type: DataTypes.DATE, defaultValue: Sequelize.NOW }
}, { tableName: 'demands' });

// 4. Modelo de Observações/Comentários
const Comment = sequelize.define('Comment', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  demand_id: { type: DataTypes.INTEGER, allowNull: false },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  content: { type: DataTypes.TEXT, allowNull: false },
  created_at: { type: DataTypes.DATE, defaultValue: Sequelize.NOW }
}, { tableName: 'comments' });

// 5. Modelo de Histórico (Audit Logs)
const AuditLog = sequelize.define('AuditLog', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  demand_id: { type: DataTypes.INTEGER, allowNull: true },
  user_id: { type: DataTypes.INTEGER, allowNull: false },
  action_type: { type: DataTypes.STRING, allowNull: false }, // CREATE, FORWARD, STATUS_CHANGE, COMMENT_ADD
  description: { type: DataTypes.STRING, allowNull: false },
  created_at: { type: DataTypes.DATE, defaultValue: Sequelize.NOW }
}, { tableName: 'audit_logs' });

// ==========================================
// ASSOCIAÇÕES / RELACIONAMENTOS
// ==========================================

// Relacionamentos da Demanda
Demand.belongsTo(Patient, { foreignKey: 'patient_id', as: 'patient' });
Demand.belongsTo(User, { foreignKey: 'creator_id', as: 'creator' });
Demand.belongsTo(User, { foreignKey: 'current_user_id', as: 'current_user' });
Demand.hasMany(Comment, { foreignKey: 'demand_id', as: 'comments', onDelete: 'CASCADE' });
Demand.hasMany(AuditLog, { foreignKey: 'demand_id', as: 'audit_logs', onDelete: 'SET NULL' });

// Relacionamentos de Observações
Comment.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
Comment.belongsTo(Demand, { foreignKey: 'demand_id' });

// Relacionamentos de Histórico
AuditLog.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
AuditLog.belongsTo(Demand, { foreignKey: 'demand_id' });

// Inicialização das tabelas
async function initDb() {
  try {
    await sequelize.authenticate();
    console.log('Conexão com SQLite estabelecida com sucesso.');
    // Sincroniza tabelas no banco (cria caso não existam)
    await sequelize.sync();
    console.log('Modelos sincronizados com o banco de dados.');
  } catch (error) {
    console.error('Erro ao conectar ou sincronizar o banco de dados:', error);
  }
}

module.exports = {
  sequelize,
  User,
  Patient,
  Demand,
  Comment,
  AuditLog,
  initDb
};
