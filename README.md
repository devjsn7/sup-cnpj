# SupCnpj

API pública que consulta e agrega dados de CNPJ de múltiplas fontes em uma única resposta unificada.

## Recursos

- Agregação de múltiplas fontes públicas em paralelo
- Cache em memória com TTL de 15 minutos
- Validação de CNPJ
- Normalização e formatação de dados (CNPJ, CNAE, CEP, telefone)
- Merge e deduplicação de sócios e atividades secundárias
- Endpoints específicos por seção

## Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/` | Informações da API |
| GET | `/cnpj/:cnpj` | Consulta completa agregada |
| GET | `/cnpj/:cnpj/resumo` | Resumo |
| GET | `/cnpj/:cnpj/socios` | Quadro societário |
| GET | `/cnpj/:cnpj/simples` | Simples / MEI / Regime tributário |
| GET | `/cnpj/:cnpj/atividades` | CNAE principal + secundárias |
| GET | `/cnpj/:cnpj/endereco` | Endereço |
| GET | `/cnpj/:cnpj/inscricoes` | Inscrições estaduais/municipais/SUFRAMA |
| GET | `/cnpj/:cnpj/regime` | Regime tributário |
| GET | `/health` | Status da API |
