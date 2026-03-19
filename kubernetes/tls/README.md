# Kubernetes TLS Certificate Management with cert-manager
#
# This directory contains Kubernetes manifests for automatic TLS certificate
# management using cert-manager and Let's Encrypt.
#
# Prerequisites:
#   1. Install cert-manager: https://cert-manager.io/docs/installation/
#   2. Create DNS records for your domain
#   3. Update email address in cluster-issuer.yaml

# Quick Setup:
# ```bash
# # Install cert-manager
# kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml
#
# # Wait for cert-manager to be ready
# kubectl wait --for=condition=available --timeout=300s deployment/cert-manager -n cert-manager
#
# # Apply ClusterIssuer
# kubectl apply -f cluster-issuer.yaml
#
# # Apply Certificate
# kubectl apply -f certificate.yaml
# ```
#
# Verify:
# ```bash
# kubectl get certificates -n shipyard-cp
# kubectl describe certificate shipyard-cp-cert -n shipyard-cp
# ```