const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Op } = require('sequelize');
const { initDb, User, Patient, Demand, Comment, AuditLog, sequelize } = require('./database');

// Helper para converter datas com segurança (string ou objeto Date)
function safeParseDate(val) {
  if (!val) return new Date();
  if (typeof val === 'string') {
    if (val.includes(' ') && !val.includes('T')) {
      return new Date(val.replace(' ', 'T'));
    }
    return new Date(val);
  }
  return new Date(val);
}

const app = express();
const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const SECRET_KEY = process.env.JWT_SECRET;
const CORS_ORIGINS = (process.env.CORS_ORIGIN || '').split(',').map(origin => origin.trim()).filter(Boolean);

if (NODE_ENV === 'production' && (!SECRET_KEY || SECRET_KEY.trim().length < 32)) {
  throw new Error('JWT_SECRET deve ser definido com pelo menos 32 caracteres em produção.');
}

app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || CORS_ORIGINS.length === 0 || CORS_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Origem bloqueada pelo CORS.'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '1mb' }));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Muitas tentativas de login. Tente novamente em 15 minutos.' }
});

// Servir arquivos estáticos do frontend da pasta 'static'
app.use(express.static(path.join(__dirname, 'static')));

// Middleware para verificar token JWT
function tokenRequired(req, res, next) {
  let token = null;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.split(' ')[1];
  }
  
  if (!token) {
    return res.status(401).json({ message: 'Sessão não autorizada. Faça login novamente.' });
  }
  
  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    req.currentUser = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Sessão expirada. Por favor, faça login novamente.' });
    }
    return res.status(401).json({ message: 'Token inválido. Faça login novamente.' });
  }
}

// Middleware para verificar se o usuário é Administrador
function adminRequired(req, res, next) {
  if (req.currentUser && req.currentUser.role === 'Admin') {
    next();
  } else {
    return res.status(403).json({ message: 'Acesso negado. Esta ação é exclusiva para Administradores.' });
  }
}

// Rota principal para servir o index.html da SPA

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'static', 'index.html'));
});

// ==========================================
// ROTAS DE AUTENTICAÇÃO
// ==========================================

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ message: 'Usuário e senha são obrigatórios!' });
  }
  
  try {
    const user = await User.findOne({ where: { username: username.trim() } });
    if (!user) {
      return res.status(401).json({ message: 'Usuário não encontrado.' });
    }
    
    // Verificar senha com bcryptjs
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Senha incorreta.' });
    }
    
    // Criar token JWT com validade de 24 horas
    const token = jwt.sign({
      user_id: user.id,
      username: user.username,
      name: user.name,
      role: user.role
    }, SECRET_KEY, { expiresIn: '24h' });
    
    return res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role
      }
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro interno do servidor.' });
  }
});

app.get('/api/auth/me', tokenRequired, (req, res) => {
  return res.json(req.currentUser);
});

app.put('/api/auth/profile', tokenRequired, async (req, res) => {
  const { name, password } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ message: 'O nome é obrigatório.' });
  }

  try {
    const user = await User.findByPk(req.currentUser.user_id);
    if (!user) {
      return res.status(404).json({ message: 'Usuário não encontrado.' });
    }

    const updates = { name: name.trim() };
    if (password && password.trim()) {
      updates.password = await bcrypt.hash(password.trim(), 10);
    }

    await user.update(updates);

    // Gerar um novo token JWT com os dados atualizados
    const token = jwt.sign({
      user_id: user.id,
      username: user.username,
      name: user.name,
      role: user.role
    }, SECRET_KEY, { expiresIn: '24h' });

    return res.json({
      message: 'Perfil atualizado com sucesso!',
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role
      }
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao atualizar perfil.' });
  }
});

// ==========================================
// ROTAS DE USUÁRIOS
// ==========================================

app.get('/api/users', tokenRequired, async (req, res) => {
  try {
    const users = await User.findAll({
      attributes: ['id', 'username', 'name', 'role'],
      order: [['name', 'ASC']]
    });
    return res.json(users);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao buscar usuários.' });
  }
});

app.post('/api/users', tokenRequired, adminRequired, async (req, res) => {
  const { username, password, name, role } = req.body;
  if (!username || !password || !name || !role) {
    return res.status(400).json({ message: 'Todos os campos são obrigatórios!' });
  }
  
  try {
    const existingUser = await User.findOne({ where: { username: username.trim() } });
    if (existingUser) {
      return res.status(400).json({ message: 'Este nome de usuário já está em uso.' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      username: username.trim(),
      password: hashedPassword,
      name: name.trim(),
      role: role.trim()
    });
    
    return res.status(201).json({
      message: 'Usuário criado com sucesso!',
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role
      }
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao criar usuário.' });
  }
});

app.put('/api/users/:id', tokenRequired, adminRequired, async (req, res) => {
  const userId = parseInt(req.params.id);
  const { username, password, name, role } = req.body;
  
  if (!username || !name || !role) {
    return res.status(400).json({ message: 'Usuário, nome e perfil são obrigatórios!' });
  }
  
  try {
    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ message: 'Usuário não encontrado.' });
    }
    
    const existingUser = await User.findOne({ 
      where: { 
        username: username.trim(),
        id: { [Op.ne]: userId }
      } 
    });
    if (existingUser) {
      return res.status(400).json({ message: 'Este nome de usuário já está em uso.' });
    }
    
    // Se for o único admin, não permitir mudar a role para colaborador
    if (user.role === 'Admin' && role !== 'Admin') {
      const adminCount = await User.count({ where: { role: 'Admin' } });
      if (adminCount <= 1) {
        return res.status(400).json({ message: 'Não é possível alterar a função do único Administrador do sistema.' });
      }
    }
    
    const updates = {
      username: username.trim(),
      name: name.trim(),
      role: role.trim()
    };
    
    if (password && password.trim()) {
      updates.password = await bcrypt.hash(password.trim(), 10);
    }
    
    await user.update(updates);
    
    return res.json({
      message: 'Usuário atualizado com sucesso!',
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role
      }
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao atualizar usuário.' });
  }
});

app.delete('/api/users/:id', tokenRequired, adminRequired, async (req, res) => {
  const userId = parseInt(req.params.id);
  
  if (userId === req.currentUser.user_id) {
    return res.status(400).json({ message: 'Você não pode excluir a si mesmo.' });
  }
  
  try {
    const user = await User.findByPk(userId);
    if (!user) {
      return res.status(404).json({ message: 'Usuário não encontrado.' });
    }
    
    if (user.role === 'Admin') {
      const adminCount = await User.count({ where: { role: 'Admin' } });
      if (adminCount <= 1) {
        return res.status(400).json({ message: 'Não é possível excluir o único Administrador do sistema.' });
      }
    }
    
    await user.destroy();
    return res.json({ message: 'Usuário excluído com sucesso!' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao excluir usuário.' });
  }
});

app.delete('/api/demands/:id', tokenRequired, adminRequired, async (req, res) => {
  const demandId = parseInt(req.params.id);
  try {
    const demand = await Demand.findByPk(demandId, {
      include: [{ model: Patient, as: 'patient' }]
    });
    if (!demand) {
      return res.status(404).json({ message: 'Processo não encontrado.' });
    }
    
    // Registrar no log de auditoria geral (demand_id = null)
    await AuditLog.create({
      demand_id: null,
      user_id: req.currentUser.user_id,
      action_type: 'DELETE',
      description: `Excluiu o processo nº ${demand.process_number} (Paciente: ${demand.patient ? demand.patient.name : 'N/A'}, Título: ${demand.title})`
    });
    
    await demand.destroy();
    return res.json({ message: 'Processo excluído com sucesso!' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao excluir processo.' });
  }
});

app.get('/api/audit-logs', tokenRequired, async (req, res) => {
  const { start_date, end_date, user_id } = req.query;
  try {
    const whereClause = {};
    if (user_id) {
      whereClause.user_id = user_id;
    }
    
    if (start_date && end_date) {
      whereClause.created_at = {
        [Op.between]: [new Date(start_date + ' 00:00:00'), new Date(end_date + ' 23:59:59')]
      };
    } else if (start_date) {
      whereClause.created_at = {
        [Op.gte]: new Date(start_date + ' 00:00:00')
      };
    } else if (end_date) {
      whereClause.created_at = {
        [Op.lte]: new Date(end_date + ' 23:59:59')
      };
    }
    
    const logs = await AuditLog.findAll({
      where: whereClause,
      include: [
        { model: User, as: 'user', attributes: ['name', 'role'] }
      ],
      order: [['created_at', 'DESC']]
    });
    
    const formatted = logs.map(l => {
      const plain = l.get({ plain: true });
      plain.user_name = plain.user ? plain.user.name : 'Sistema';
      plain.user_role = plain.user ? plain.user.role : '';
      return plain;
    });
    
    return res.json(formatted);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao buscar logs de auditoria.' });
  }
});

// ==========================================
// ROTAS DE PACIENTES
// ==========================================

app.get('/api/patients', tokenRequired, async (req, res) => {
  const search = (req.query.search || '').trim();
  const isAdmin = req.currentUser.role === 'Admin';
  
  if (!search && !isAdmin) {
    return res.status(403).json({ message: 'Acesso negado. A listagem completa de pacientes é restrita a Administradores.' });
  }
  
  try {
    let whereClause = {};
    if (search) {
      const cleanSearch = search.replace(/\D/g, '');
      const orConditions = [
        { name: { [Op.like]: `%${search}%` } }
      ];
      
      if (cleanSearch) {
        // Remove os pontos e traços do CPF e espaços do CNS na consulta
        orConditions.push(
          sequelize.where(
            sequelize.fn('REPLACE', sequelize.fn('REPLACE', sequelize.col('cpf'), '.', ''), '-', ''),
            { [Op.like]: `%${cleanSearch}%` }
          )
        );
        orConditions.push(
          sequelize.where(
            sequelize.fn('REPLACE', sequelize.col('cns'), ' ', ''),
            { [Op.like]: `%${cleanSearch}%` }
          )
        );
      } else {
        orConditions.push({ cpf: { [Op.like]: `%${search}%` } });
        orConditions.push({ cns: { [Op.like]: `%${search}%` } });
      }
      
      whereClause = {
        [Op.or]: orConditions
      };
    }
    
    const patients = await Patient.findAll({
      where: whereClause,
      order: [['name', 'ASC']]
    });
    return res.json(patients);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao buscar pacientes.' });
  }
});

app.post('/api/patients', tokenRequired, adminRequired, async (req, res) => {
  const { name, cpf, cns, mother_name, birth_date } = req.body;
  if (!name) {
    return res.status(400).json({ message: 'O nome do paciente é obrigatório!' });
  }
  
  try {
    const patient = await Patient.create({
      name: name.trim(),
      cpf: cpf ? cpf.trim() : null,
      cns: cns ? cns.trim() : null,
      mother_name: mother_name ? mother_name.trim() : null,
      birth_date: birth_date ? birth_date.trim() : null
    });
    
    return res.status(201).json(patient);
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({ message: 'Já existe um paciente cadastrado com este CPF.' });
    }
    console.error(error);
    return res.status(500).json({ message: 'Erro ao cadastrar paciente.' });
  }
});

app.put('/api/patients/:id', tokenRequired, adminRequired, async (req, res) => {
  const patientId = parseInt(req.params.id);
  const { name, cpf, cns, mother_name, birth_date } = req.body;
  if (!name) {
    return res.status(400).json({ message: 'O nome do paciente é obrigatório!' });
  }
  
  try {
    const patient = await Patient.findByPk(patientId);
    if (!patient) {
      return res.status(404).json({ message: 'Paciente não encontrado.' });
    }
    
    await patient.update({
      name: name.trim(),
      cpf: cpf ? cpf.trim() : null,
      cns: cns ? cns.trim() : null,
      mother_name: mother_name ? mother_name.trim() : null,
      birth_date: birth_date ? birth_date.trim() : null
    });
    
    return res.json(patient);
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({ message: 'Já existe um paciente cadastrado com este CPF.' });
    }
    console.error(error);
    return res.status(500).json({ message: 'Erro ao atualizar paciente.' });
  }
});


// ==========================================
// ROTAS DE DEMANDAS
// ==========================================

app.get('/api/demands', tokenRequired, async (req, res) => {
  const statusFilter = (req.query.status || '').trim();
  const search = (req.query.search || '').trim();
  const myDemands = req.query.my_demands === 'true';
  const startDate = (req.query.start_date || '').trim();
  const endDate = (req.query.end_date || '').trim();
  
  try {
    const whereClause = {};
    
    if (statusFilter) {
      whereClause.status = statusFilter;
    }
    
    if (myDemands) {
      whereClause.current_user_id = req.currentUser.user_id;
    }
    
    // Filtro por período de recebimento
    if (startDate && endDate) {
      whereClause.received_at = {
        [Op.between]: [startDate + ' 00:00:00', endDate + ' 23:59:59']
      };
    } else if (startDate) {
      whereClause.received_at = {
        [Op.gte]: startDate + ' 00:00:00'
      };
    } else if (endDate) {
      whereClause.received_at = {
        [Op.lte]: endDate + ' 23:59:59'
      };
    }
    
    // Preparar busca textual em múltiplas tabelas usando includes
    let patientInclude = { model: Patient, as: 'patient' };
    let currentUserInclude = { model: User, as: 'current_user' };
    
    if (search) {
      const cleanSearch = search.replace(/\D/g, '');
      const orConditions = [
        { process_number: { [Op.like]: `%${search}%` } },
        { prodata_number: { [Op.like]: `%${search}%` } },
        { title: { [Op.like]: `%${search}%` } },
        { '$patient.name$': { [Op.like]: `%${search}%` } },
        { '$current_user.name$': { [Op.like]: `%${search}%` } }
      ];
      
      if (cleanSearch) {
        // Busca de paciente sem formatação por CPF e CNS na lista de demandas
        orConditions.push(
          sequelize.where(
            sequelize.fn('REPLACE', sequelize.fn('REPLACE', sequelize.col('patient.cpf'), '.', ''), '-', ''),
            { [Op.like]: `%${cleanSearch}%` }
          )
        );
        orConditions.push(
          sequelize.where(
            sequelize.fn('REPLACE', sequelize.col('patient.cns'), ' ', ''),
            { [Op.like]: `%${cleanSearch}%` }
          )
        );
      } else {
        orConditions.push({ '$patient.cpf$': { [Op.like]: `%${search}%` } });
        orConditions.push({ '$patient.cns$': { [Op.like]: `%${search}%` } });
      }
      
      whereClause[Op.or] = orConditions;
    }
    
    const rows = await Demand.findAll({
      where: whereClause,
      include: [
        patientInclude,
        { model: User, as: 'creator', attributes: ['name'] },
        currentUserInclude
      ],
      order: [['deadline', 'ASC']]
    });
    
    const demands = [];
    const now = new Date();
    
    for (let row of rows) {
      const d = row.get({ plain: true });
      
      // Mapeamento dos nomes para compatibilidade com o frontend
      d.patient_name = d.patient ? d.patient.name : '';
      d.patient_cpf = d.patient ? d.patient.cpf : '';
      d.creator_name = d.creator ? d.creator.name : '';
      d.current_name = d.current_user ? d.current_user.name : '';
      
      // Calcular prazos dinamicamente
      const deadlineDt = safeParseDate(d.deadline);
      const timeDiff = deadlineDt - now;
      
      if (d.status === 'Concluído') {
        d.time_left = 'Concluído';
        d.urgency = 'neutral';
      } else if (timeDiff < 0) {
        d.time_left = 'Atrasado';
        d.urgency = 'critical';
        
        // Atualizar status no banco se não constava como atrasado
        if (d.status !== 'Atrasado') {
          await row.update({ status: 'Atrasado', updated_at: now });
          d.status = 'Atrasado';
        }
      } else {
        const totalHours = timeDiff / 3600000;
        const days = Math.floor(timeDiff / 86400000);
        const hours = Math.floor((timeDiff % 86400000) / 3600000);
        const minutes = Math.floor((timeDiff % 3600000) / 60000);
        
        if (days > 0) {
          d.time_left = `Restam ${days}d e ${hours}h`;
        } else {
          d.time_left = `Restam ${hours}h e ${minutes}m`;
        }
        
        if (totalHours <= 24) {
          d.urgency = 'critical';
        } else if (totalHours <= 72) {
          d.urgency = 'warning';
        } else {
          d.urgency = 'normal';
        }
      }
      
      demands.push(d);
    }
    
    return res.json(demands);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao buscar demandas.' });
  }
});

app.get('/api/demands/:id', tokenRequired, async (req, res) => {
  const demandId = parseInt(req.params.id);
  
  try {
    const row = await Demand.findByPk(demandId, {
      include: [
        { model: Patient, as: 'patient' },
        { model: User, as: 'creator', attributes: ['name'] },
        { model: User, as: 'current_user', attributes: ['name'] }
      ]
    });
    
    if (!row) {
      return res.status(404).json({ message: 'Demanda não encontrada.' });
    }
    
    const demand = row.get({ plain: true });
    
    // Mapeamentos compatíveis com front
    demand.patient_name = demand.patient ? demand.patient.name : '';
    demand.patient_cpf = demand.patient ? demand.patient.cpf : '';
    demand.patient_cns = demand.patient ? demand.patient.cns : '';
    demand.patient_mother = demand.patient ? demand.patient.mother_name : '';
    demand.patient_birth = demand.patient ? demand.patient.birth_date : '';
    demand.creator_name = demand.creator ? demand.creator.name : '';
    demand.current_name = demand.current_user ? demand.current_user.name : '';
    
    // Prazo dinâmico
    const now = new Date();
    const deadlineDt = safeParseDate(demand.deadline);
    const timeDiff = deadlineDt - now;
    
    if (demand.status === 'Concluído') {
      demand.time_left = 'Concluído';
      demand.urgency = 'neutral';
    } else if (timeDiff < 0) {
      demand.time_left = 'Atrasado';
      demand.urgency = 'critical';
    } else {
      const totalHours = timeDiff / 3600000;
      const days = Math.floor(timeDiff / 86400000);
      const hours = Math.floor((timeDiff % 86400000) / 3600000);
      const minutes = Math.floor((timeDiff % 3600000) / 60000);
      
      if (days > 0) {
        demand.time_left = `Restam ${days}d e ${hours}h`;
      } else {
        demand.time_left = `Restam ${hours}h e ${minutes}m`;
      }
      
      if (totalHours <= 24) {
        demand.urgency = 'critical';
      } else if (totalHours <= 72) {
        demand.urgency = 'warning';
      } else {
        demand.urgency = 'normal';
      }
    }
    
    // Buscar observações vinculando nome do usuário
    const comments = await Comment.findAll({
      where: { demand_id: demandId },
      include: [{ model: User, as: 'user', attributes: ['name', 'role'] }],
      order: [['created_at', 'DESC']]
    });
    
    demand.comments = comments.map(c => {
      const plain = c.get({ plain: true });
      plain.user_name = plain.user ? plain.user.name : '';
      plain.user_role = plain.user ? plain.user.role : '';
      return plain;
    });
    
    // Buscar logs de auditoria
    const logs = await AuditLog.findAll({
      where: { demand_id: demandId },
      include: [{ model: User, as: 'user', attributes: ['name', 'role'] }],
      order: [['created_at', 'DESC']]
    });
    
    demand.audit_logs = logs.map(l => {
      const plain = l.get({ plain: true });
      plain.user_name = plain.user ? plain.user.name : '';
      plain.user_role = plain.user ? plain.user.role : '';
      return plain;
    });
    
    // Verificar se a demanda já foi encaminhada alguma vez
    const hasBeenForwarded = await AuditLog.findOne({
      where: {
        demand_id: demandId,
        action_type: 'FORWARD'
      }
    });
    demand.has_been_forwarded = !!hasBeenForwarded;
    
    return res.json(demand);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao buscar detalhes da demanda.' });
  }
});

app.post('/api/demands', tokenRequired, async (asyncReq, res) => {
  const { process_number, prodata_number, patient_id, title, description, judge, received_at, deadline, current_user_id } = asyncReq.body;
  
  const requiredFields = ['process_number', 'patient_id', 'title', 'received_at', 'deadline', 'current_user_id'];
  for (let field of requiredFields) {
    if (!asyncReq.body || !asyncReq.body[field]) {
      return res.status(400).json({ message: `O campo '${field}' é obrigatório!` });
    }
  }
  
  const creatorId = asyncReq.currentUser.user_id;
  let deadlineFormatted = deadline;
  let receivedFormatted = received_at;
  
  // Tratar formato HTML datetime-local (YYYY-MM-DDTHH:MM) para formato YYYY-MM-DD HH:MM:SS
  if (deadlineFormatted.includes('T')) {
    deadlineFormatted = deadlineFormatted.replace('T', ' ');
    if (deadlineFormatted.length === 16) {
      deadlineFormatted += ':00';
    }
  }

  if (receivedFormatted.includes('T')) {
    receivedFormatted = receivedFormatted.replace('T', ' ');
    if (receivedFormatted.length === 16) {
      receivedFormatted += ':00';
    }
  }
  
  try {
    // 1. Criar demanda
    const demand = await Demand.create({
      process_number: process_number.trim(),
      prodata_number: prodata_number ? prodata_number.trim() : null,
      patient_id: parseInt(patient_id),
      title: title.trim(),
      description: description ? description.trim() : '',
      judge: judge ? judge.trim() : null,
      received_at: receivedFormatted,
      deadline: deadlineFormatted,
      status: 'Pendente',
      creator_id: creatorId,
      current_user_id: parseInt(current_user_id)
    });
    
    // 2. Registrar no log de auditoria
    await AuditLog.create({
      demand_id: demand.id,
      user_id: creatorId,
      action_type: 'CREATE',
      description: 'Demanda judicial criada no sistema.'
    });
    
    // Se foi atribuído a outro usuário inicialmente, registra log de encaminhamento
    if (parseInt(current_user_id) !== parseInt(creatorId)) {
      const targetUser = await User.findByPk(parseInt(current_user_id));
      const targetName = targetUser ? targetUser.name : 'Outro Usuário';
      
      await AuditLog.create({
        demand_id: demand.id,
        user_id: creatorId,
        action_type: 'FORWARD',
        description: `Demanda encaminhada no cadastro inicial para ${targetName}.`
      });
    }
    
    return res.status(201).json({ message: 'Demanda criada com sucesso!', demand_id: demand.id });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao criar demanda judicial.' });
  }
});

app.put('/api/demands/:id', tokenRequired, async (req, res) => {
  const demandId = parseInt(req.params.id);
  const { 
    process_number, 
    prodata_number, 
    patient_id, 
    title, 
    description, 
    judge, 
    received_at, 
    deadline 
  } = req.body;
  
  try {
    const demand = await Demand.findByPk(demandId);
    if (!demand) {
      return res.status(404).json({ message: 'Demanda não encontrada.' });
    }
    
    const isCreator = demand.creator_id === req.currentUser.user_id;
    const isAdmin = req.currentUser.role === 'Admin';
    
    // Validar regras de permissão
    if (isAdmin) {
      if (demand.status === 'Concluído') {
        return res.status(403).json({ message: 'Não é possível editar processos encerrados (concluídos).' });
      }
    } else if (isCreator) {
      const hasBeenForwarded = await AuditLog.findOne({
        where: {
          demand_id: demandId,
          action_type: 'FORWARD'
        }
      });
      if (hasBeenForwarded) {
        return res.status(403).json({ message: 'Este processo já foi encaminhado anteriormente, portanto o criador não pode mais editá-lo.' });
      }
    } else {
      return res.status(403).json({ message: 'Você não tem permissão para editar esta demanda.' });
    }
    
    // Salvar campos antigos para log detalhado
    const oldFields = {
      process_number: demand.process_number,
      prodata_number: demand.prodata_number,
      patient_id: demand.patient_id,
      title: demand.title,
      description: demand.description,
      judge: demand.judge,
      received_at: demand.received_at,
      deadline: demand.deadline
    };
    
    let deadlineFormatted = deadline;
    let receivedFormatted = received_at;
    
    if (deadlineFormatted && deadlineFormatted.includes('T')) {
      deadlineFormatted = deadlineFormatted.replace('T', ' ');
      if (deadlineFormatted.length === 16) {
        deadlineFormatted += ':00';
      }
    }
    if (receivedFormatted && receivedFormatted.includes('T')) {
      receivedFormatted = receivedFormatted.replace('T', ' ');
      if (receivedFormatted.length === 16) {
        receivedFormatted += ':00';
      }
    }
    
    // Atualizar demanda
    await demand.update({
      process_number: process_number ? process_number.trim() : demand.process_number,
      prodata_number: prodata_number !== undefined ? (prodata_number ? prodata_number.trim() : null) : demand.prodata_number,
      patient_id: patient_id !== undefined ? parseInt(patient_id) : demand.patient_id,
      title: title ? title.trim() : demand.title,
      description: description !== undefined ? (description ? description.trim() : '') : demand.description,
      judge: judge ? judge.trim() : demand.judge,
      received_at: receivedFormatted || demand.received_at,
      deadline: deadlineFormatted || demand.deadline,
      updated_at: new Date()
    });
    
    // Comparar e registrar alterações no AuditLog
    const changes = [];
    if (oldFields.process_number !== demand.process_number) {
      changes.push(`Nº Processo (${oldFields.process_number} -> ${demand.process_number})`);
    }
    if (oldFields.prodata_number !== demand.prodata_number) {
      changes.push(`ProData (${oldFields.prodata_number || 'Nenhum'} -> ${demand.prodata_number || 'Nenhum'})`);
    }
    if (oldFields.patient_id !== demand.patient_id) {
      const oldPat = await Patient.findByPk(oldFields.patient_id);
      const newPat = await Patient.findByPk(demand.patient_id);
      changes.push(`Paciente (${oldPat ? oldPat.name : oldFields.patient_id} -> ${newPat ? newPat.name : demand.patient_id})`);
    }
    if (oldFields.title !== demand.title) {
      changes.push(`Título (${oldFields.title} -> ${demand.title})`);
    }
    if (oldFields.description !== demand.description) {
      changes.push(`Descrição alterada`);
    }
    if (oldFields.judge !== demand.judge) {
      changes.push(`Juiz (${oldFields.judge || 'Não informado'} -> ${demand.judge})`);
    }
    if (oldFields.received_at !== demand.received_at) {
      changes.push(`Data Recebimento (${oldFields.received_at} -> ${demand.received_at})`);
    }
    if (oldFields.deadline !== demand.deadline) {
      changes.push(`Prazo Limite (${oldFields.deadline} -> ${demand.deadline})`);
    }
    
    const changeDesc = changes.length > 0 
      ? `Editou a demanda judicial: ${changes.join(', ')}.` 
      : 'Editou a demanda judicial sem alterações de campos.';
    
    await AuditLog.create({
      demand_id: demandId,
      user_id: req.currentUser.user_id,
      action_type: 'UPDATE',
      description: changeDesc
    });
    
    return res.json({ message: 'Demanda judicial atualizada com sucesso!', demand });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao editar a demanda judicial.' });
  }
});

app.post('/api/demands/:id/forward', tokenRequired, async (req, res) => {
  const demandId = parseInt(req.params.id);
  const { new_user_id } = req.body;
  if (!new_user_id) {
    return res.status(400).json({ message: 'O novo responsável é obrigatório!' });
  }
  
  const currentUserId = req.currentUser.user_id;
  const isAdmin = req.currentUser.role === 'Admin';
  
  try {
    const demand = await Demand.findByPk(demandId);
    if (!demand) {
      return res.status(404).json({ message: 'Demanda não encontrada.' });
    }
    
    // Somente o responsável atual ou Admin pode encaminhar
    if (demand.current_user_id !== currentUserId && !isAdmin) {
      return res.status(403).json({ message: 'Acesso negado. Apenas o responsável atual do processo ou o Administrador podem realizar o encaminhamento.' });
    }
    
    const targetUser = await User.findByPk(parseInt(new_user_id));
    if (!targetUser) {
      return res.status(404).json({ message: 'Responsável não encontrado no sistema.' });
    }
    
    await demand.update({
      current_user_id: parseInt(new_user_id),
      updated_at: new Date()
    });
    
    await AuditLog.create({
      demand_id: demandId,
      user_id: currentUserId,
      action_type: 'FORWARD',
      description: `Demanda encaminhada para ${targetUser.name}.`
    });
    
    return res.json({ message: `Demanda encaminhada com sucesso para ${targetUser.name}!` });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao encaminhar demanda.' });
  }
});

app.post('/api/demands/:id/status', tokenRequired, async (req, res) => {
  const demandId = parseInt(req.params.id);
  const { status } = req.body;
  if (!status) {
    return res.status(400).json({ message: 'O novo status é obrigatório!' });
  }
  
  if (!['Pendente', 'Em Andamento', 'Concluído', 'Atrasado'].includes(status)) {
    return res.status(400).json({ message: 'Status inválido.' });
  }
  
  const currentUserId = req.currentUser.user_id;
  const isAdmin = req.currentUser.role === 'Admin';
  
  try {
    const demand = await Demand.findByPk(demandId);
    if (!demand) {
      return res.status(404).json({ message: 'Demanda não encontrada.' });
    }
    
    // Se não for admin e nem o responsável atual, nega
    const isAssignee = demand.current_user_id === currentUserId;
    if (!isAssignee && !isAdmin) {
      return res.status(403).json({ message: 'Você não tem permissão para alterar o status deste processo pois não é o responsável atual.' });
    }
    
    // Se o status atual for Concluído, apenas Admin pode alterar
    if (demand.status === 'Concluído' && !isAdmin) {
      return res.status(403).json({ message: 'Apenas Administradores podem reabrir ou alterar o status de um processo concluído.' });
    }
    
    const oldStatus = demand.status;
    await demand.update({
      status,
      updated_at: new Date()
    });
    
    await AuditLog.create({
      demand_id: demandId,
      user_id: currentUserId,
      action_type: 'STATUS_CHANGE',
      description: `Alterou o status de '${oldStatus}' para '${status}'.`
    });
    
    return res.json({ message: `Status alterado para ${status} com sucesso!` });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao alterar status da demanda.' });
  }
});

app.post('/api/demands/:id/comments', tokenRequired, async (req, res) => {
  const demandId = parseInt(req.params.id);
  const { content } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ message: 'O conteúdo da observação é obrigatório!' });
  }
  
  const currentUserId = req.currentUser.user_id;
  
  try {
    const demand = await Demand.findByPk(demandId);
    if (!demand) {
      return res.status(404).json({ message: 'Demanda não encontrada.' });
    }
    
    // Validar se o usuário atual é o responsável pela posse da demanda
    if (demand.current_user_id !== currentUserId) {
      return res.status(403).json({ message: 'Apenas o responsável atual pela demanda pode adicionar observações.' });
    }
    
    await Comment.create({
      demand_id: demandId,
      user_id: currentUserId,
      content: content.trim()
    });
    
    await AuditLog.create({
      demand_id: demandId,
      user_id: currentUserId,
      action_type: 'COMMENT_ADD',
      description: 'Adicionou uma observação.'
    });
    
    return res.status(201).json({ message: 'Observação adicionada com sucesso!' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao adicionar observação.' });
  }
});

app.put('/api/comments/:id', tokenRequired, async (req, res) => {
  const commentId = parseInt(req.params.id);
  const { content } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ message: 'O conteúdo da observação não pode ser vazio.' });
  }
  
  try {
    const comment = await Comment.findByPk(commentId);
    if (!comment) {
      return res.status(404).json({ message: 'Observação não encontrada.' });
    }
    
    // Apenas o autor original pode editar
    if (comment.user_id !== req.currentUser.user_id) {
      return res.status(403).json({ message: 'Apenas o autor original da observação pode editá-la.' });
    }
    
    // A edição é proibida caso a demanda já tenha sido encaminhada para outro usuário
    const hasBeenForwarded = await AuditLog.findOne({
      where: {
        demand_id: comment.demand_id,
        action_type: 'FORWARD'
      }
    });
    
    if (hasBeenForwarded) {
      return res.status(400).json({ message: 'Não é possível editar esta observação pois a demanda correspondente já foi encaminhada.' });
    }
    
    await comment.update({
      content: content.trim()
    });
    
    await AuditLog.create({
      demand_id: comment.demand_id,
      user_id: req.currentUser.user_id,
      action_type: 'COMMENT_EDIT',
      description: 'Editou uma observação.'
    });
    
    return res.json({ message: 'Observação editada com sucesso!', comment });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Erro ao editar observação.' });
  }
});

// Inicialização do Banco de Dados e Execução do Servidor
async function startServer() {
  await initDb();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
  });
}

startServer();
