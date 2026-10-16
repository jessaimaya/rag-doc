#!/bin/bash

# Test script for Medical Insurance Assistant API
URL="${API_URL:-http://localhost:4111}/api/agents/insuranceAgent/generate"

echo "Testing Medical Insurance Assistant..."
echo "URL: $URL"
echo ""

# Test question in Spanish
curl -X POST "$URL" \
  -H "x-api-key: ${MASTRA_API_KEY:-}" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "role": "user",
        "content": "¿Cuáles son los requisitos para programar una cirugía con GNP?"
      }
    ]
  }' | jq '.'

echo ""
echo "Test completed!"
