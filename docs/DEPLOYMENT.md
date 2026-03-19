# Shipyard Control Plane - Deployment Guide

## Overview

This guide covers deployment options for Shipyard Control Plane, from development to production environments.

## Prerequisites

- Node.js 20+
- Docker & Docker Compose (for containerized deployment)
- Redis 7+ (for persistence)
- API keys for external services (GitHub, OpenAI, Anthropic, etc.)

## Quick Start (Docker)

```bash
# Clone and configure
git clone https://github.com/RNA4219/shipyard-cp.git
cd shipyard-cp

# Copy environment file
cp .env.example .env

# Edit .env with your API keys
# - GITHUB_TOKEN
# - OPENAI_API_KEY
# - ANTHROPIC_API_KEY
# - GOOGLE_API_KEY

# Start all services
cd docker
docker-compose up -d

# Check health
curl http://localhost:3000/health
```

## Production Deployment

### 1. Environment Configuration

Copy `.env.example` to `.env` and configure:

```bash
# Required for production
NODE_ENV=production
REDIS_URL=redis://your-redis-host:6379
REDIS_KEY_PREFIX=shipyard-cp-prod:

# External services (use production URLs)
MEMX_RESOLVER_URL=https://resolver.your-domain.com
TRACKER_BRIDGE_URL=https://tracker.your-domain.com

# Authentication (implement before production)
API_KEY=your-secure-api-key
ADMIN_API_KEY=your-admin-api-key

# Worker API keys
GITHUB_TOKEN=ghp_xxx
OPENAI_API_KEY=sk-xxx
ANTHROPIC_API_KEY=sk-ant-xxx
GOOGLE_API_KEY=xxx
```

### 2. Redis Setup

#### Option A: Managed Redis (Recommended)

Use a managed Redis service:
- AWS ElastiCache
- Google Cloud Memorystore
- Azure Cache for Redis
- Upstash

```bash
REDIS_URL=redis://:password@your-redis-host:6379
```

#### Option B: Self-hosted Redis

```bash
# Using Docker
docker run -d \
  --name redis \
  -p 6379:6379 \
  -v redis-data:/data \
  redis:7-alpine \
  redis-server --appendonly yes --maxmemory 512mb
```

### 3. Control Plane Deployment

#### Option A: Docker Compose

```bash
cd docker
docker-compose -f docker-compose.yml up -d
```

#### Option B: Kubernetes

```yaml
# kubernetes/deployment.yaml (example)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: shipyard-cp
spec:
  replicas: 3
  selector:
    matchLabels:
      app: shipyard-cp
  template:
    metadata:
      labels:
        app: shipyard-cp
    spec:
      containers:
      - name: shipyard-cp
        image: shipyard-cp:latest
        ports:
        - containerPort: 3000
        envFrom:
        - configMapRef:
            name: shipyard-cp-config
        - secretRef:
            name: shipyard-cp-secrets
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
```

#### Option C: Cloud Run / Fargate

```bash
# Build and push image
docker build -t shipyard-cp:latest -f docker/shipyard-cp/Dockerfile .
docker tag shipyard-cp:latest gcr.io/your-project/shipyard-cp:latest
docker push gcr.io/your-project/shipyard-cp:latest

# Deploy to Cloud Run
gcloud run deploy shipyard-cp \
  --image gcr.io/your-project/shipyard-cp:latest \
  --set-env-vars NODE_ENV=production \
  --set-secrets REDIS_URL=redis-url:latest
```

### 4. External Services Setup

#### memx-resolver

Production deployment for document resolution:

```bash
# Deploy memx-resolver (example)
cd memx-resolver
docker-compose -f docker-compose.prod.yml up -d
```

#### tracker-bridge

Production deployment for tracker integration:

```bash
# Deploy tracker-bridge (example)
cd tracker-bridge
docker-compose -f docker-compose.prod.yml up -d
```

### 5. Health Checks

```bash
# Control Plane health
curl http://localhost:3000/health

# Redis health
redis-cli ping

# Full health check
curl http://localhost:3000/health/ready
```

### 6. Monitoring

#### Logs

```bash
# Docker logs
docker-compose logs -f shipyard-cp

# Kubernetes logs
kubectl logs -f deployment/shipyard-cp
```

#### Metrics (TODO)

Prometheus metrics endpoint: `/metrics`

## Scaling Considerations

### Horizontal Scaling

With Redis persistence, you can run multiple Control Plane instances:

```yaml
# docker-compose.scale.yml
services:
  shipyard-cp:
    deploy:
      replicas: 3
```

### Load Balancer

Use a load balancer (nginx, HAProxy, cloud LB) in front:

```nginx
upstream shipyard-cp {
    server shipyard-cp-1:3000;
    server shipyard-cp-2:3000;
    server shipyard-cp-3:3000;
}

server {
    listen 80;
    location / {
        proxy_pass http://shipyard-cp;
    }
}
```

## TLS/HTTPS Configuration

### Overview

shipyard-cp supports automatic TLS certificate management through:

1. **Let's Encrypt (ACME)** - Free, automatic certificates
2. **cert-manager** - Kubernetes-native certificate management
3. **Certificate Monitor** - Expiry monitoring and alerting

### Option A: Docker Compose with Let's Encrypt

Use the provided `scripts/tls-cert-manager.sh` for automatic certificate management:

```bash
# Initial setup (requires port 80 to be free)
DOMAIN=shipyard.your-domain.com EMAIL=admin@your-domain.com \
  ./scripts/tls-cert-manager.sh setup

# Check certificate status
./scripts/tls-cert-manager.sh check

# Renew certificates
./scripts/tls-cert-manager.sh renew

# Setup automatic renewal cron job
./scripts/tls-cert-manager.sh cron
```

Environment variables:
- `DOMAIN` - Your domain name
- `EMAIL` - Email for Let's Encrypt registration
- `CERT_DIR` - Certificate directory (default: `./certs`)
- `STAGING=true` - Use Let's Encrypt staging (for testing)

### Option B: Kubernetes with cert-manager

For Kubernetes deployments, use cert-manager for automatic certificate management:

```bash
# Install cert-manager
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml

# Wait for cert-manager to be ready
kubectl wait --for=condition=available --timeout=300s deployment/cert-manager -n cert-manager

# Update email in cluster-issuer.yaml
sed -i 's/admin@example.com/your-email@example.com/g' kubernetes/tls/cluster-issuer.yaml

# Apply TLS configuration
kubectl apply -f kubernetes/tls/cluster-issuer.yaml
kubectl apply -f kubernetes/tls/certificate.yaml
kubectl apply -f kubernetes/tls/ingress.yaml
```

Verify certificate status:
```bash
kubectl get certificates -n shipyard-cp
kubectl describe certificate shipyard-cp-cert -n shipyard-cp
```

### Option C: Cloud Provider TLS

For cloud deployments (Cloud Run, Fargate, etc.), use managed TLS:

**Google Cloud Run:**
```bash
# Cloud Run automatically provisions TLS for custom domains
gcloud run domain-mappings create \
  --service shipyard-cp \
  --domain shipyard.your-domain.com
```

**AWS Fargate with ALB:**
```bash
# Use AWS Certificate Manager
aws acm request-certificate \
  --domain-name shipyard.your-domain.com \
  --validation-method DNS
```

### Certificate Monitoring

The `CertificateMonitor` class provides automatic expiry alerts:

```typescript
import { CertificateMonitor, createSlackAlertHandler } from './tls';

const monitor = new CertificateMonitor({
  certPath: '/etc/letsencrypt/live/domain/fullchain.pem',
  warningDays: 30,   // Alert 30 days before expiry
  criticalDays: 7,   // Critical alert 7 days before expiry
  onWarning: createSlackAlertHandler(process.env.SLACK_WEBHOOK_URL!),
});

monitor.start();  // Checks daily
```

### Development Certificates

For local development, generate a self-signed certificate:

```bash
# Using the script
./scripts/tls-cert-manager.sh dev-cert

# Or using openssl directly
openssl req -x509 -newkey rsa:4096 \
  -keyout certs/key.pem \
  -out certs/cert.pem \
  -days 365 -nodes \
  -subj "/CN=localhost"
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TLS_ENABLED` | Enable TLS | `false` |
| `TLS_CERT_PATH` | Path to certificate file | - |
| `TLS_KEY_PATH` | Path to private key file | - |
| `TLS_CA_PATH` | Path to CA certificate (mTLS) | - |
| `TLS_MIN_VERSION` | Minimum TLS version | `TLSv1.2` |
| `TLS_HSTS` | Enable HSTS header | `true` |
| `TRUST_PROXY` | Trust reverse proxy headers | `false` |

## Security Checklist

- [ ] Enable authentication (API_KEY)
- [ ] Configure TLS/HTTPS
- [ ] Use secrets management (not .env files in production)
- [ ] Restrict Redis access (network/VPC)
- [ ] Enable Redis AUTH
- [ ] Configure CORS appropriately
- [ ] Review and rotate API keys regularly
- [ ] Enable audit logging

## Troubleshooting

### Common Issues

1. **Redis connection refused**
   ```bash
   # Check Redis is running
   redis-cli ping

   # Check network connectivity
   telnet redis-host 6379
   ```

2. **Out of memory**
   ```bash
   # Increase Redis maxmemory
   redis-cli config set maxmemory 512mb
   ```

3. **Slow responses**
   ```bash
   # Check Redis latency
   redis-cli --latency

   # Check memory usage
   redis-cli info memory
   ```

### Logs

Set log level for debugging:

```bash
LOG_LEVEL=debug
DEBUG_SHIPYARD=*
```

## Backup & Recovery

### Redis Backup

```bash
# Trigger RDB snapshot
redis-cli BGSAVE

# Copy dump file
cp /var/lib/redis/dump.rdb /backup/redis-$(date +%Y%m%d).rdb
```

### Disaster Recovery

1. Restore Redis from backup
2. Restart Control Plane services
3. Verify data integrity with health checks

## Maintenance

### Rolling Updates

```bash
# Kubernetes rolling update
kubectl set image deployment/shipyard-cp shipyard-cp=shipyard-cp:v2

# Docker Compose
docker-compose pull shipyard-cp
docker-compose up -d shipyard-cp
```

### Database Migrations

Currently using Redis - no schema migrations needed.

## Cost Estimation

| Component | Cloud Provider | Estimated Cost |
|-----------|---------------|----------------|
| Control Plane (3 instances) | AWS/GCP | $50-100/month |
| Redis (1GB) | ElastiCache/Memorystore | $20-50/month |
| Load Balancer | AWS ALB/GCP LB | $20-30/month |
| **Total** | | **$90-180/month** |

## Next Steps

1. Implement authentication (P1)
2. Add CI/CD pipeline
3. Set up monitoring and alerting
4. Configure backup automation
5. Security hardening