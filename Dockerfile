FROM node:24-slim
WORKDIR /app
COPY . .
ENV PORT=8080
ENV NODE_ENV=production
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "const p=process.env.PORT||'8080';const h=require('http');h.get('http://localhost:'+p+'/',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"
CMD ["node", "server.js"]
