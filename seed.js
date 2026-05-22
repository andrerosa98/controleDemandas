const bcrypt = require('bcryptjs');
const { initDb, User, Patient, Demand, Comment, AuditLog, sequelize } = require('./database');

async function seed(options = {}) {
  const force = Boolean(options.force);

  // Inicializar o banco primeiro
  await initDb({ force });

  // Se já existirem usuários, presumimos que o banco já foi populado — pular seeding.
  try {
    const existing = await User.count();
    if (existing && existing > 0) {
      console.log('Seed pulado: o banco já contém dados.');
      return { skipped: true };
    }
  } catch (err) {
    console.error('Erro ao verificar dados existentes:', err);
    // prosseguir para tentar popular caso a verificação falhe
  }

  console.log("Cadastrando usuários de teste...");
  const salt = await bcrypt.genSalt(10);
  const passAdmin = await bcrypt.hash("admin123", salt);
  const passUser = await bcrypt.hash("user123", salt);

  const users = await User.bulkCreate([
    { username: 'admin', password: passAdmin, name: 'Administrador do Sistema', role: 'Admin' },
    { username: 'usuario1', password: passUser, name: 'Dr. Lucas Ribeiro (Advogado)', role: 'Advogado' },
    { username: 'usuario2', password: passUser, name: 'Dra. Patricia Lima (Médica)', role: 'Médico' }
  ]);

  const userMap = {};
  users.forEach(u => {
    userMap[u.username] = u.id;
  });

  console.log("Cadastrando pacientes de teste...");
  const patients = await Patient.bulkCreate([
    { name: 'João da Silva', cpf: '123.456.789-00', cns: '898001234567890', mother_name: 'Maria da Silva', birth_date: '1985-05-15' },
    { name: 'Ana Souza Cruz', cpf: '987.654.321-11', cns: '700123456789012', mother_name: 'Teresa Souza', birth_date: '1992-09-20' },
    { name: 'Marcos Oliveira', cpf: '456.789.123-22', cns: '800987654321012', mother_name: 'Lucia Oliveira', birth_date: '1970-11-02' }
  ]);

  const patientMap = {};
  patients.forEach(p => {
    patientMap[p.name] = p.id;
  });

  console.log("Cadastrando demandas judiciais de teste...");
  
  // Prazos dinâmicos baseados no momento atual
  const formatDate = (date) => {
    return date.toISOString().replace('T', ' ').substring(0, 19);
  };
  
  const now = new Date();
  
  // Demanda 1 (Recebido há 6 horas, prazo de 24h, expira em 18h)
  const received1 = new Date(now.getTime() - 6 * 60 * 60 * 1000);
  const deadline1 = new Date(received1.getTime() + 24 * 60 * 60 * 1000);
  
  // Demanda 2 (Recebido há 20.5 horas, prazo de 24h, expira em 3.5h)
  const received2 = new Date(now.getTime() - 20.5 * 60 * 60 * 1000);
  const deadline2 = new Date(received2.getTime() + 24 * 60 * 60 * 1000);
  
  // Demanda 3 (Recebido há 5 dias, prazo de 15 dias, expira em 10 dias)
  const received3 = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
  const deadline3 = new Date(received3.getTime() + 15 * 24 * 60 * 60 * 1000);
  
  // Demanda 4 (Recebido há 7 dias, prazo de 2 dias, expirou há 5 dias)
  const received4 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const deadline4 = new Date(received4.getTime() + 2 * 24 * 60 * 60 * 1000);

  const demands = await Demand.bulkCreate([
    {
      process_number: '5001234-56.2026.8.21.0001',
      prodata_number: '2026.990.101',
      patient_id: patientMap['João da Silva'],
      title: 'Medicamento Alfa para tratamento cardíaco',
      description: 'Liminar concedida determinando o fornecimento do medicamento Alfa em até 24 horas. Receita médica anexada.',
      judge: 'Dr. Roberto Sobrinho',
      received_at: formatDate(received1),
      deadline: formatDate(deadline1),
      status: 'Pendente',
      creator_id: userMap['admin'],
      current_user_id: userMap['usuario1']
    },
    {
      process_number: '5019876-12.2026.8.21.0002',
      prodata_number: '2026.448.202',
      patient_id: patientMap['Ana Souza Cruz'],
      title: 'Internação imediata em leito de UTI Pediátrica',
      description: 'Decisão judicial urgente sob pena de multa diária de R$ 5.000,00. Paciente aguarda transferência na UPA Centro.',
      judge: 'Dra. Helena de Souza',
      received_at: formatDate(received2),
      deadline: formatDate(deadline2),
      status: 'Em Andamento',
      creator_id: userMap['admin'],
      current_user_id: userMap['admin']
    },
    {
      process_number: '5005544-33.2026.8.21.0003',
      prodata_number: '2026.102.903',
      patient_id: patientMap['Marcos Oliveira'],
      title: 'Cirurgia eletiva de artropatia de quadril',
      description: 'Cumprimento de sentença determinando o agendamento e realização da cirurgia no prazo de 15 dias.',
      judge: 'Dr. Marcos Aurélio',
      received_at: formatDate(received3),
      deadline: formatDate(deadline3),
      status: 'Pendente',
      creator_id: userMap['admin'],
      current_user_id: userMap['usuario2']
    },
    {
      process_number: '5008899-44.2026.8.21.0004',
      prodata_number: '2026.004.404',
      patient_id: patientMap['João da Silva'],
      title: 'Exame de Ressonância Magnética com contraste',
      description: 'Decisão deferindo antecipação de tutela para a realização de exame de imagem de alta complexidade.',
      judge: 'Dra. Patricia Medeiros',
      received_at: formatDate(received4),
      deadline: formatDate(deadline4),
      status: 'Concluído',
      creator_id: userMap['usuario1'],
      current_user_id: userMap['usuario1']
    }
  ]);

  const demandMap = {};
  demands.forEach(d => {
    demandMap[d.title] = d.id;
  });

  console.log("Inserindo observações e histórico de auditoria...");
  
  await Comment.bulkCreate([
    {
      demand_id: demandMap['Internação imediata em leito de UTI Pediátrica'],
      user_id: userMap['admin'],
      content: 'Leito indisponível na rede pública local. Solicitado bloqueio de valores ou internação em hospital privado credenciado.'
    },
    {
      demand_id: demandMap['Exame de Ressonância Magnética com contraste'],
      user_id: userMap['usuario1'],
      content: 'Exame agendado e realizado com sucesso no Hospital Geral no dia anterior.'
    }
  ]);

  await AuditLog.bulkCreate([
    // Demanda 1
    { demand_id: demandMap['Medicamento Alfa para tratamento cardíaco'], user_id: userMap['admin'], action_type: 'CREATE', description: 'Demanda criada no sistema.' },
    { demand_id: demandMap['Medicamento Alfa para tratamento cardíaco'], user_id: userMap['admin'], action_type: 'FORWARD', description: 'Demanda encaminhada para o responsável Dr. Lucas Ribeiro (usuario1).' },
    
    // Demanda 2
    { demand_id: demandMap['Internação imediata em leito de UTI Pediátrica'], user_id: userMap['admin'], action_type: 'CREATE', description: 'Demanda criada no sistema.' },
    { demand_id: demandMap['Internação imediata em leito de UTI Pediátrica'], user_id: userMap['admin'], action_type: 'STATUS_CHANGE', description: 'Status alterado para Em Andamento.' },
    { demand_id: demandMap['Internação imediata em leito de UTI Pediátrica'], user_id: userMap['admin'], action_type: 'COMMENT_ADD', description: 'Adicionou observação sobre a falta de leitos públicos.' },
    
    // Demanda 3
    { demand_id: demandMap['Cirurgia eletiva de artropatia de quadril'], user_id: userMap['admin'], action_type: 'CREATE', description: 'Demanda criada no sistema.' },
    { demand_id: demandMap['Cirurgia eletiva de artropatia de quadril'], user_id: userMap['admin'], action_type: 'FORWARD', description: 'Demanda encaminhada para a responsável Dra. Patricia Lima (usuario2).' },
    
    // Demanda 4
    { demand_id: demandMap['Exame de Ressonância Magnética com contraste'], user_id: userMap['usuario1'], action_type: 'CREATE', description: 'Demanda criada no sistema.' },
    { demand_id: demandMap['Exame de Ressonância Magnética com contraste'], user_id: userMap['usuario1'], action_type: 'COMMENT_ADD', description: 'Adicionou observação sobre o agendamento realizado.' },
    { demand_id: demandMap['Exame de Ressonância Magnética com contraste'], user_id: userMap['usuario1'], action_type: 'STATUS_CHANGE', description: 'Status alterado para Concluído pelo responsável.' }
  ]);

  console.log("Banco de dados populado com sucesso!");
  return { skipped: false };
}

if (require.main === module) {
  seed({ force: String(process.env.FORCE_SEED || '').toLowerCase() === 'true' })
    .then(() => process.exit(0))
    .catch(err => {
      console.error("Erro durante o seeding:", err);
      process.exit(1);
    });
}

module.exports = { seed };
