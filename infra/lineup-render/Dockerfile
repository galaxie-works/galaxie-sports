# Servidor do Playwright do serviço lineup-render (página oficial do plano que só mostra a grade com JavaScript).
# Sobre a imagem oficial (navegadores em /ms-playwright e dependências do sistema), com o pacote npm `playwright` na
# versão exata e com integridade do package-lock.json: o contêiner não baixa nada do npm na partida.
# A versão é uma só na base abaixo, no package.json/package-lock.json daqui, no playwright-core do services/ai-agents
# e na tag da imagem no infra/vps-telemetry/compose.yml; o CI confere (node infra/lineup-render/versions.mjs).
# Tag e digest do FROM sobem juntos: o digest (do índice multi-arquitetura) sai de
# `docker buildx imagetools inspect mcr.microsoft.com/playwright:v<versão>-noble`; o job lineup-render avisa se a
# tag passou a apontar para outro digest.
#   docker build -t galaxie-sports-lineup-render infra/lineup-render
FROM mcr.microsoft.com/playwright:v1.64.0-noble@sha256:06a9939e57531807f8d5fd76ce44b53165ffb7d7501d87ab10e285c20b1e971f
WORKDIR /opt/playwright-server
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
ENV NODE_ENV=production
# Abre páginas de terceiros: nunca como root (pwuser vem da imagem oficial; o pacote fica só para leitura).
USER pwuser
WORKDIR /home/pwuser
EXPOSE 3000
ENTRYPOINT ["node", "/opt/playwright-server/node_modules/playwright/cli.js", "run-server"]
CMD ["--port", "3000", "--host", "0.0.0.0"]
