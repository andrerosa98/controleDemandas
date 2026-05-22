# JurisFlow - Controle de Demandas Judiciais (Saúde)

O **JurisFlow** é um sistema web-based responsivo e moderno projetado para controlar demandas judiciais da área da saúde, focado na gestão de prazos críticos (dias e horas), responsáveis, auditoria de ações e histórico de observações dos pacientes.

## Tecnologias Utilizadas
* **Backend**: Node.js + Express
* **ORM & Banco de Dados**: Sequelize com PostgreSQL
* **Frontend**: HTML5, CSS3 (Vanilla com tema escuro glassmorphic de alta fidelidade e suporte a tema claro), e JavaScript Vanilla (SPA completo com gráficos interativos via Chart.js).
* **Autenticação**: JSON Web Tokens (JWT) com senhas criptografadas via `bcryptjs`.

## Funcionalidades do Sistema
* **Dashboard Dinâmico**: Indicadores rápidos de demandas atribuídas, críticas, alertas e concluídas, além de gráficos visuais de carga de trabalho e status. Contadores regressivos atualizam os prazos em tempo real na tela.
* **Cadastro de Pacientes (Exclusivo Admin)**: Armazenamento detalhado de pacientes (Nome completo, CPF, CNS, Nome da Mãe e Data de Nascimento). Máscara automática de digitação para o CPF.
* **Cadastro de Demandas**: Processo judicial atrelado a um paciente e um responsável, contendo campo para Juiz Assinante, Código ProData (com máscara de formatação automática `XXXX.XXX.XXX`), data e hora inicial de recebimento e prazos em dias/horas (cálculo dinâmico automático do prazo limite).
* **Pesquisa Sem Formatação**: Busca flexível de pacientes por CPF ou CNS sem formatação em todas as áreas do sistema (autocompletar de nova demanda, listagem de pacientes e filtros de demandas).
* **Controle de Posse e Encaminhamento**: O responsável atual pode transferir a posse da demanda para outro usuário através de uma janela de confirmação de segurança (modal).
* **Observações e Histórico**: Andamentos do processo com linha do tempo de auditoria automática. Inserção de observações restrita ao responsável atual, e edição restrita ao autor original (bloqueada permanentemente se o processo já tiver sido encaminhado).

## Como Rodar o Projeto

### Pré-requisitos
Certifique-se de ter o **Node.js** e o **npm** instalados em sua máquina.

### Configuração do Banco
Copie o arquivo `.env.example` para `.env` e preencha as credenciais do PostgreSQL.

### Variáveis de Produção
Em produção, defina `NODE_ENV=production`, um `JWT_SECRET` longo e único, e `CORS_ORIGIN` com o domínio público do frontend.

### Instalação de Dependências
```bash
npm install
```

### Execução da Migração/Seed
O comando abaixo recria o banco do zero e popula os dados iniciais:
```bash
npm run seed
```

### Inicialização do Servidor de Desenvolvimento
```bash
npm run dev
```
O servidor iniciará na porta **5000**. Acesse: **[http://localhost:5000](http://localhost:5000)**

## Deploy Recomendado

Para uso real, a combinação mais simples é:

1. Frontend e backend no mesmo app Node.
2. Banco PostgreSQL gerenciado no próprio provedor.
3. Variáveis de ambiente configuradas no painel do provedor.

### Boas práticas mínimas
- Não comite o arquivo `.env`.
- Use uma senha forte para o usuário do PostgreSQL.
- Gere um `JWT_SECRET` longo e aleatório.
- Restrinja `CORS_ORIGIN` ao domínio público do app.
- Mantenha `NODE_ENV=production` no deploy.

### Deploy no Render
Este repositório já inclui um Blueprint em `render.yaml` para criar o app e o banco PostgreSQL juntos.

Passo a passo:
1. Envie o código para o GitHub.
2. No Render, clique em `New` > `Blueprint`.
3. Conecte o repositório deste projeto.
4. O Render vai ler o `render.yaml`, criar o banco PostgreSQL e o serviço web.
5. Aguarde o primeiro deploy e a execução automática do `npm run seed`.

Observação:
- O `JWT_SECRET` é gerado automaticamente pelo Render.
- O backend usa `DATABASE_URL` no Render e continua compatível com `.env` local.

## Usuários de Teste Pré-Cadastrados

| Usuário | Senha | Nome Completo | Perfil |
| :--- | :--- | :--- | :--- |
| `admin` | `admin123` | Administrador do Sistema | Administrador (Admin) |
| `usuario1` | `user123` | Dr. Lucas Ribeiro | Advogado |
| `usuario2` | `user123` | Dra. Patricia Lima | Analista |
