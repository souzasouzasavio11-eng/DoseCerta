# DoseCerta — primeira versão

Aplicativo Android para organizar horários cadastrados pelo próprio usuário. Não recomenda medicamentos, doses ou intervalos.

## O que já está implementado
- Cadastro, edição e exclusão de medicamentos.
- Cálculo da próxima ocorrência a partir da última dose e do intervalo informado.
- Virada de dia e intervalos maiores que 24 horas.
- Registro manual de dose tomada e histórico local.
- Agendamento de até 20 lembretes futuros por medicamento no Android.

## Como gerar o APK pelo GitHub
1. Envie todos os arquivos desta pasta para um repositório GitHub chamado `DoseCerta`.
2. Confirme que a branch principal se chama `main`.
3. Abra a aba **Actions** do repositório e habilite workflows, se o GitHub solicitar.
4. O workflow `Build DoseCerta APK` será executado após o primeiro envio. Também pode ser iniciado em **Actions → Build DoseCerta APK → Run workflow**.
5. Abra a execução concluída, desça até **Artifacts** e baixe `DoseCerta-debug-apk`.
6. Extraia o ZIP baixado e instale `app-debug.apk` no Android.

## Observações importantes
- Este primeiro APK é uma compilação **debug**, adequada para testes. Não é uma versão assinada para publicação na Play Store.
- Os dados ficam no armazenamento local do aplicativo. Desinstalar o app pode apagar os dados.
- O app agenda as próximas 20 ocorrências por medicamento. Abra o app periodicamente para atualizar os lembretes futuros.
- Android pode exigir permissão de notificações. Economia de bateria, alarmes exatos e configurações do fabricante podem afetar a entrega.
- A ação “Registrar dose tomada” atualiza a última dose para o horário atual. Use somente quando a dose tiver sido realmente tomada.
- Confira sempre os horários com a prescrição e as orientações do profissional de saúde.

## Desenvolvimento local
Requer Node.js 22:
```bash
npm install
npm run build
npx cap add android
npx cap sync android
```
