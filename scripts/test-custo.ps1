$orgId = "ccd9fcb3-2f81-4299-bf7d-f6244b795715"
$token = "blablabla"

Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3001/v1/organizations/$orgId/model-prices" `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json" `
  -Body (@{
    provider = "ollama"
    model = "llama3.2"
    currency = "USD"
    inputPricePerMillion = "0.10"
    outputPricePerMillion = "0.20"
    priceSource = "internal_simulation"
    priceType = "internal_estimate"
    effectiveFrom = "2026-11-02T00:00:00Z"
  } | ConvertTo-Json)



$key = "aisp_live_3078eb34_5c96f462e2b2c7f38fd4b67b408b24ea6f6c784a20a2b6a8"

Invoke-RestMethod -Method Post `
  -Uri "http://localhost:3002/v1/chat/completions" `
  -Headers @{ Authorization = "Bearer $key" } `
  -ContentType "application/json" `
  -Body (@{
    model = "llama3.2"
    messages = @(@{ role = "user"; content = "Responda apenas: teste" })
  } | ConvertTo-Json -Depth 5)

