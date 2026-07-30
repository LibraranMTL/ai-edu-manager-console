param(
  [Parameter(Mandatory = $true)]
  [string]$Descriptor
)

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding

function Write-McpResponse {
  param([object]$Value)
  [Console]::Out.WriteLine(($Value | ConvertTo-Json -Depth 32 -Compress))
  [Console]::Out.Flush()
}

function Read-Descriptor {
  if (-not (Test-Path -LiteralPath $Descriptor -PathType Leaf)) {
    throw 'The Education Manager knowledge tool is not ready. Start the host service first.'
  }
  return Get-Content -LiteralPath $Descriptor -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Knowledge-Tool-Definition {
  param([object]$Config)
  $scopeName = [string]$Config.defaults.scopeName
  if ([string]::IsNullOrWhiteSpace($scopeName)) { $scopeName = 'current student' }
  $teamEnabled = [bool]$Config.teamQueryPolicy.allowLocalTeamKnowledgeQuery -or [bool]$Config.teamQueryPolicy.allowRemoteTeamKnowledgeQuery
  if ($teamEnabled) { $scopeName = 'the allowed Education Manager team scope' }
  return @{
    name = 'query_education_knowledge'
    title = ('Query education knowledge for {0}' -f $scopeName)
    description = ('Query read-only education knowledge for {0}, including student archives and linked learning-project knowledge. When the user explicitly names a student, pass that exact name or ID in student; never substitute another student. Without a named student, team scope is used only when its long-term policy is enabled. Search local knowledge first, then authorized collaboration hosts on demand. Returns edu:// citations, student/project attribution, freshness and transport.' -f $scopeName)
    inputSchema = @{
      type = 'object'
      properties = @{
        question = @{
          type = 'string'
          minLength = 1
          maxLength = 2000
          description = 'A complete natural-language education question.'
        }
        student = @{
          type = 'string'
          maxLength = 200
          description = 'Optional exact student name or ID when the user explicitly names a student. Never guess, never substitute another student, and never substitute the active student for a different named student.'
        }
        forceRemote = @{
          type = 'boolean'
          default = $false
          description = 'Diagnostic override only. Keep false for local-first routing.'
        }
      }
      required = @('question')
      additionalProperties = $false
    }
  }
}

function Conversation-Tool-Definition {
  param([object]$Config)
  $scopeName = [string]$Config.defaults.scopeName
  if ([string]::IsNullOrWhiteSpace($scopeName)) { $scopeName = 'current student' }
  $projectNames = @($Config.defaults.projects | ForEach-Object { [string]$_.name } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  $projectHint = if ($projectNames.Count -gt 0) {
    ' Linked projects: ' + ($projectNames -join ', ') + '.'
  } else {
    ' This student currently has no linked projects.'
  }
  return @{
    name = 'submit_education_conversation'
    title = ('Save conversation to Education Manager for {0}' -f $scopeName)
    description = (('Save only the current or explicitly selected conversation messages for student {0}. Omit targetProject to save to the student archive; when the user explicitly names a project, pass its exact name or ID in targetProject. A named project must resolve uniquely or nothing is stored.' -f $scopeName) + $projectHint)
    inputSchema = @{
      type = 'object'
      properties = @{
        title = @{
          type = 'string'
          maxLength = 240
          description = 'A short title for the selected conversation.'
        }
        sessionId = @{
          type = 'string'
          maxLength = 240
          description = 'A stable ID for the current chat when available.'
        }
        sourceAgent = @{
          type = 'string'
          maxLength = 120
          description = 'The calling agent name, such as qclaw or codex.'
        }
        targetProject = @{
          type = 'string'
          maxLength = 240
          description = 'Optional exact linked project name or project ID. Omit only when the user wants the student conversation archive.'
        }
        messages = @{
          type = 'array'
          minItems = 1
          maxItems = 300
          description = 'Only the current or explicitly selected messages. Do not submit private history from other chats.'
          items = @{
            type = 'object'
            properties = @{
              role = @{ type = 'string'; enum = @('user', 'assistant', 'tool', 'system') }
              content = @{ type = 'string'; minLength = 1; maxLength = 60000 }
              occurredAt = @{ type = 'string' }
            }
            required = @('role', 'content')
            additionalProperties = $false
          }
        }
        attachments = @{
          type = 'array'
          maxItems = 20
          description = 'Files explicitly selected by the user for this submission.'
          items = @{
            type = 'object'
            properties = @{
              sourcePath = @{ type = 'string'; minLength = 1; maxLength = 2000 }
              name = @{ type = 'string'; maxLength = 240 }
              explicitlySelected = @{ type = 'boolean'; const = $true }
            }
            required = @('sourcePath', 'explicitlySelected')
            additionalProperties = $false
          }
        }
      }
      required = @('messages')
      additionalProperties = $false
    }
  }
}

function Invoke-EducationManagerApi {
  param(
    [object]$Config,
    [string]$Endpoint,
    [object]$Body
  )
  $tokenPath = [string]$Config.authentication.tokenFile
  if (-not (Test-Path -LiteralPath $tokenPath -PathType Leaf)) {
    throw 'The Education Manager credential is not ready.'
  }
  $token = (Get-Content -LiteralPath $tokenPath -Raw -Encoding UTF8).Trim()
  return Invoke-RestMethod `
    -Method Post `
    -Uri $Endpoint `
    -Headers @{ Authorization = "Bearer $token" } `
    -ContentType 'application/json; charset=utf-8' `
    -Body ([System.Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 32 -Compress))) `
    # A remote knowledge lookup may first exhaust an unreachable LAN address,
    # then retry through Tailscale and test several extracted query phrases.
    # Keep the local MCP-to-host request alive for that bounded routing window.
    -TimeoutSec 75
}

function Invoke-KnowledgeTool {
  param([object]$Arguments)
  $config = Read-Descriptor
  $question = [string]$Arguments.question
  if ([string]::IsNullOrWhiteSpace($question)) {
    throw 'A knowledge question is required.'
  }
  $body = @{
    scopeType = [string]$config.defaults.scopeType
    scopeId = [string]$config.defaults.scopeId
    scopePolicy = [string]$config.defaults.scopePolicy
    student = [string]$Arguments.student
    question = $question.Trim()
    forceRemote = [bool]$Arguments.forceRemote
    limit = 8
  }
  $teamEnabled = [bool]$config.teamQueryPolicy.allowLocalTeamKnowledgeQuery -or [bool]$config.teamQueryPolicy.allowRemoteTeamKnowledgeQuery
  if ($teamEnabled) {
    $body.scopeType = 'team'
    $body.scopeId = 'team'
    $body.queryScope = 'all_allowed'
  }
  $result = Invoke-EducationManagerApi -Config $config -Endpoint ([string]$config.endpoint) -Body $body
  $text = if ($result.prompt) {
    [string]$result.prompt
  } elseif ($result.message) {
    [string]$result.message
  } else {
    $result | ConvertTo-Json -Depth 20
  }
  return @{
    content = @(@{ type = 'text'; text = $text })
    structuredContent = $result
    # An empty but completed lookup is a valid result. Only an unavailable
    # collaboration route should be surfaced as a tool error.
    isError = ([string]$result.source -eq 'waiting')
  }
}

function Invoke-ConversationTool {
  param([object]$Arguments)
  $config = Read-Descriptor
  if ($null -eq $Arguments.messages -or @($Arguments.messages).Count -eq 0) {
    throw 'At least one selected conversation message is required.'
  }
  $sessionId = [string]$Arguments.sessionId
  if ([string]::IsNullOrWhiteSpace($sessionId)) {
    $sessionId = "native-session-$((Get-Date).ToUniversalTime().ToString('yyyy-MM-dd'))"
  }
  $sourceAgent = [string]$Arguments.sourceAgent
  if ([string]::IsNullOrWhiteSpace($sourceAgent)) { $sourceAgent = 'native-agent' }
  $scopeType = [string]$config.defaults.scopeType
  $scopeId = [string]$config.defaults.scopeId
  $targetProject = [string]$Arguments.targetProject
  $body = @{
    scopeType = $scopeType
    scopeId = $scopeId
    studentHint = [string]$config.defaults.scopeId
    targetProject = $targetProject.Trim()
    sourceAgent = $sourceAgent.Trim()
    sessionId = $sessionId.Trim()
    title = [string]$Arguments.title
    messages = @($Arguments.messages)
    attachments = @($Arguments.attachments)
  }
  $result = Invoke-EducationManagerApi -Config $config -Endpoint ([string]$config.conversationEndpoint) -Body $body
  $text = if ($result.message) {
    [string]$result.message
  } else {
    $result | ConvertTo-Json -Depth 20
  }
  return @{
    content = @(@{ type = 'text'; text = $text })
    structuredContent = $result
    isError = -not [bool]$result.ok
  }
}

while ($null -ne ($line = [Console]::In.ReadLine())) {
  if ([string]::IsNullOrWhiteSpace($line)) { continue }
  $request = $null
  try {
    $request = $line | ConvertFrom-Json
    $hasId = $request.PSObject.Properties.Name -contains 'id'
    $method = [string]$request.method
    if ($method -eq 'notifications/initialized' -or $method -eq 'notifications/cancelled') { continue }
    if (-not $hasId) { continue }

    $result = switch ($method) {
      'initialize' {
        @{
          protocolVersion = if ($request.params.protocolVersion) { [string]$request.params.protocolVersion } else { '2025-06-18' }
          capabilities = @{ tools = @{ listChanged = $false } }
          serverInfo = @{ name = 'edu-manager-knowledge'; title = 'Education Manager Knowledge'; version = '1.0.1' }
          instructions = 'Use query_education_knowledge for education questions. When the user names a student, pass the exact name or ID in the student argument and never substitute another student. An unnamed query can use team scope only when Education Manager reports that its long-term policy is enabled. Use submit_education_conversation only when the user asks to save the current or selected conversation. Preserve edu:// citations, attribution, freshness and transport; do not invent unsupported claims.'
        }
      }
      'ping' { @{} }
      'tools/list' {
        $config = Read-Descriptor
        @{ tools = @((Knowledge-Tool-Definition -Config $config), (Conversation-Tool-Definition -Config $config)) }
      }
      'tools/call' {
        switch ([string]$request.params.name) {
          'query_education_knowledge' {
            Invoke-KnowledgeTool -Arguments $request.params.arguments
          }
          'submit_education_conversation' {
            Invoke-ConversationTool -Arguments $request.params.arguments
          }
          default {
            throw "Unknown tool: $($request.params.name)"
          }
        }
      }
      default { throw "Unsupported MCP method: $method" }
    }
    Write-McpResponse @{
      jsonrpc = '2.0'
      id = $request.id
      result = $result
    }
  } catch {
    if ($null -ne $request -and ($request.PSObject.Properties.Name -contains 'id')) {
      Write-McpResponse @{
        jsonrpc = '2.0'
        id = $request.id
        error = @{ code = -32000; message = $_.Exception.Message }
      }
    }
  }
}
