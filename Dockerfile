# Dockerfile pour déploiement Azure Container Instances ou App Service
FROM node:18-alpine

# Metadata
LABEL maintainer="APS Model Publisher"
LABEL description="Backend API for APS/ACC model publishing automation"

# Créer le répertoire de l'application
WORKDIR /app

# Installer les dépendances système nécessaires
RUN apk add --no-cache \
    python3 \
    make \
    g++

# Copier les fichiers package.json
COPY package*.json ./
COPY backend/package*.json ./backend/

# Installer les dépendances (backend uniquement pour production)
RUN npm ci --only=production --omit=dev && \
    cd backend && npm ci --only=production --omit=dev

# Copier le code source du backend
COPY backend/ ./backend/

# Créer un utilisateur non-root pour la sécurité
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

# Créer le répertoire des logs
RUN mkdir -p /app/backend/logs && \
    chown -R nodejs:nodejs /app/backend/logs

# Basculer vers l'utilisateur non-root
USER nodejs

# Exposer le port
EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {if(r.statusCode === 200) process.exit(0); process.exit(1);})"

# Variables d'environnement par défaut
ENV NODE_ENV=production
ENV PORT=3000

# Démarrer l'application
WORKDIR /app/backend
CMD ["node", "src/server.js"]

