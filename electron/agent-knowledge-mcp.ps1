param(
  [Parameter(Mandatory = $true)]
  [string]$Descriptor,
  [string]$ConnectorConfig = ''
)

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding

# The same MCP identity can opt into R21. Never silently fall back to the old
# activity-selected student if the upgraded runtime is missing or invalid.
if (-not [string]::IsNullOrWhiteSpace($ConnectorConfig)) {
  try {
    $runtime = Get-Content -LiteralPath $ConnectorConfig -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($runtime.schema -ne 'edu-manager.external-connection.v1' -or
        -not (Test-Path -LiteralPath $runtime.runtimeExecutable -PathType Leaf) -or
        -not (Test-Path -LiteralPath $runtime.runtimeScript -PathType Leaf)) { throw 'Unified connector runtime unavailable' }
    $env:ELECTRON_RUN_AS_NODE = '1'
    # PowerShell's native-command pipeline can buffer redirected stdin until
    # EOF. MCP is interactive and never sends EOF between requests: relay raw
    # streams concurrently rather than invoking the executable with '&'.
    Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Threading.Tasks;
public static class EducationMcpRelay {
  static string Quote(string value) { return "\"" + value.Replace("\"", "\\\"") + "\""; }
  public static int Run(string executable, string script, string config) {
    var start = new ProcessStartInfo(executable, Quote(script) + " " + Quote(config));
    start.UseShellExecute = false;
    start.CreateNoWindow = true;
    start.RedirectStandardInput = true;
    start.RedirectStandardOutput = true;
    start.RedirectStandardError = true;
    start.StandardOutputEncoding = new System.Text.UTF8Encoding(false);
    start.StandardErrorEncoding = new System.Text.UTF8Encoding(false);
    using (var child = Process.Start(start)) {
      child.StandardInput.AutoFlush = true;
      var output = Task.Run(() => { string line; while ((line = child.StandardOutput.ReadLine()) != null) { Console.Out.WriteLine(line); Console.Out.Flush(); } });
      var errors = Task.Run(() => { string line; while ((line = child.StandardError.ReadLine()) != null) { Console.Error.WriteLine(line); Console.Error.Flush(); } });
      Task.Run(() => {
        try { string line; while ((line = Console.In.ReadLine()) != null) { child.StandardInput.WriteLine(line); child.StandardInput.Flush(); } }
        catch (System.IO.IOException) { }
        finally { try { child.StandardInput.Close(); } catch { } }
      });
      child.WaitForExit();
      Task.WaitAll(output, errors);
      return child.ExitCode;
    }
  }
}
'@
    exit ([EducationMcpRelay]::Run($runtime.runtimeExecutable, $runtime.runtimeScript, $ConnectorConfig))
  } catch {
    [Console]::Error.WriteLine('Education Manager unified connector unavailable. Start the upgraded host; legacy student fallback is disabled.')
    exit 1
  }
}

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
  $teamEnabled = ([string]$Config.defaults.scopePolicy -ne 'fixed_student') -and ([bool]$Config.teamQueryPolicy.allowLocalTeamKnowledgeQuery -or [bool]$Config.teamQueryPolicy.allowRemoteTeamKnowledgeQuery)
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
    description = (('Preview only the current or explicitly selected conversation messages for student {0}. The host administrator must review and approve the returned intent before execute_education_write saves it. A named project must resolve uniquely or nothing is stored.' -f $scopeName) + $projectHint)
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
        idempotencyKey = @{ type = 'string'; maxLength = 128; description = 'Stable key for this exact selected submission. Reuse only for retries.' }
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
      }
      required = @('messages')
      additionalProperties = $false
    }
  }
}

function Capability-Tool-Definitions {
  $scope = @{ studentId = @{ type = 'string'; minLength = 1; description = 'Exact authorized student ID.' }; projectId = @{ type = 'string'; description = 'Exact linked project ID when querying project scope.' } }
  return @(
    @{ name = 'list_education_archive'; title = 'List education archive metadata'; description = 'Read only names and relative paths in the exact authorized scope. No raw file paths or contents.'; inputSchema = @{ type = 'object'; properties = ($scope + @{ cursor = @{ type = 'integer'; minimum = 0 }; limit = @{ type = 'integer'; minimum = 1; maximum = 50 } }); required = @('studentId'); additionalProperties = $false } },
    @{ name = 'get_education_task_status'; title = 'Get education task status'; description = 'Read compact task status for the exact authorized student or linked project.'; inputSchema = @{ type = 'object'; properties = ($scope + @{ cursor = @{ type = 'integer'; minimum = 0 }; limit = @{ type = 'integer'; minimum = 1; maximum = 50 } }); required = @('studentId'); additionalProperties = $false } }
  )
}

function Invoke-CapabilityTool {
  param([string]$Name, [object]$Arguments)
  $config = Read-Descriptor
  $endpoint = [string]$config.capabilityEndpoint
  if (-not $endpoint.StartsWith('http://127.0.0.1:')) { throw 'Local capability endpoint unavailable.' }
  $capabilityInput = @{
    studentId = [string]$Arguments.studentId
  }
  if ($Arguments.projectId) { $capabilityInput.projectId = [string]$Arguments.projectId }
  if ($null -ne $Arguments.cursor) { $capabilityInput.cursor = [int]$Arguments.cursor }
  if ($null -ne $Arguments.limit) { $capabilityInput.limit = [int]$Arguments.limit }
  $result = Invoke-EducationManagerApi -Config $config -Endpoint $endpoint -Body @{ name = $Name; input = $capabilityInput }
  return @{ content = @(@{ type = 'text'; text = ($result | ConvertTo-Json -Depth 20 -Compress) }); structuredContent = $result; isError = -not [bool]$result.ok }
}

function Memory-Tool-Definitions {
  $summaryProperties = @{
    objective = @{ type = 'string'; maxLength = 2000 }
    completed = @{ type = 'array'; maxItems = 20; items = @{ type = 'string'; maxLength = 1000 } }
    decisions = @{ type = 'array'; maxItems = 20; items = @{ type = 'string'; maxLength = 1000 } }
    openLoops = @{ type = 'array'; maxItems = 20; items = @{ type = 'string'; maxLength = 1000 } }
    risks = @{ type = 'array'; maxItems = 20; items = @{ type = 'string'; maxLength = 1000 } }
    nextSteps = @{ type = 'array'; maxItems = 20; items = @{ type = 'string'; maxLength = 1000 } }
  }
  $authorizedMessage = @{
    type = 'object'
    properties = @{
      eventId = @{ type = 'string'; maxLength = 240; description = 'Stable message ID from the current Agent conversation when available.' }
      role = @{ type = 'string'; enum = @('user', 'assistant') }
      content = @{ type = 'string'; minLength = 1; maxLength = 20000 }
      occurredAt = @{ type = 'string' }
    }
    required = @('role', 'content')
    additionalProperties = $false
  }
  return @(
    @{
      name = 'get_recent_education_context'
      title = 'Get recent Education Manager context'
      description = 'Load compact, student-scoped session summaries and pending handoffs before continuing work. Never returns full private transcripts.'
      inputSchema = @{ type = 'object'; properties = @{
        targetProject = @{ type = 'string'; maxLength = 240; description = 'Optional exact linked project name or ID.' }
        sourceAgent = @{ type = 'string'; maxLength = 120 }
        limit = @{ type = 'integer'; minimum = 1; maximum = 10; default = 5 }
      }; additionalProperties = $false }
    },
    @{
      name = 'start_education_session'
      title = 'Start authorized Agent conversation capture'
      description = 'After the user has enabled automatic conversation memory, start capture for this Agent current conversation only. Never scan previous or unrelated conversations.'
      inputSchema = @{ type = 'object'; properties = @{
        sessionId = @{ type = 'string'; maxLength = 240 }
        idempotencyKey = @{ type = 'string'; maxLength = 500 }
        title = @{ type = 'string'; maxLength = 500 }
        objective = @{ type = 'string'; maxLength = 2000 }
        targetProject = @{ type = 'string'; maxLength = 240 }
        sourceAgent = @{ type = 'string'; enum = @('codex', 'qclaw', 'workbuddy', 'openclaw', 'trae', 'qoder-work') }
      }; required = @('sourceAgent'); additionalProperties = $false }
    },
    @{
      name = 'record_authorized_education_turn'
      title = 'Capture the current authorized conversation turn'
      description = 'After each turn, append only the user and assistant messages from the current authorized Agent conversation. Never include system prompts, tool secrets, caches, previous chats or unrelated history. Reusing stable eventId values is idempotent.'
      inputSchema = @{ type = 'object'; properties = @{
        sessionId = @{ type = 'string'; minLength = 1; maxLength = 240 }
        targetProject = @{ type = 'string'; maxLength = 240 }
        sourceAgent = @{ type = 'string'; enum = @('codex', 'qclaw', 'workbuddy', 'openclaw', 'trae', 'qoder-work') }
        messages = @{ type = 'array'; minItems = 1; maxItems = 20; items = $authorizedMessage }
      }; required = @('sessionId', 'sourceAgent', 'messages'); additionalProperties = $false }
    },
    @{
      name = 'finalize_education_session'
      title = 'Finalize and archive authorized Agent conversation'
      description = 'Archive all incrementally captured user and assistant messages for this authorized conversation into the exact student or linked project scope. Repeating the same idempotency key is safe.'
      inputSchema = @{ type = 'object'; properties = @{
        sessionId = @{ type = 'string'; minLength = 1; maxLength = 240 }
        targetProject = @{ type = 'string'; maxLength = 240 }
        sourceAgent = @{ type = 'string'; enum = @('codex', 'qclaw', 'workbuddy', 'openclaw', 'trae', 'qoder-work') }
        idempotencyKey = @{ type = 'string'; maxLength = 500 }
        status = @{ type = 'string'; enum = @('completed', 'failed', 'cancelled') }
        summary = @{ type = 'object'; properties = $summaryProperties; additionalProperties = $false }
        targetAgent = @{ type = 'string'; maxLength = 120 }
        messages = @{ type = 'array'; maxItems = 20; items = $authorizedMessage; description = 'Optional final current-turn messages not already appended.' }
      }; required = @('sessionId', 'sourceAgent'); additionalProperties = $false }
    },
    @{
      name = 'accept_education_handoff'
      title = 'Accept education session handoff'
      description = 'Accept a non-expired handoff for the exact current student and project.'
      inputSchema = @{ type = 'object'; properties = @{
        sessionId = @{ type = 'string'; minLength = 1; maxLength = 240 }
        handoffId = @{ type = 'string'; minLength = 1; maxLength = 240 }
        targetProject = @{ type = 'string'; maxLength = 240 }
        sourceAgent = @{ type = 'string'; maxLength = 120 }
      }; required = @('sessionId', 'handoffId'); additionalProperties = $false }
    },
    @{
      name = 'cancel_education_handoff'
      title = 'Cancel education session handoff'
      description = 'Cancel a pending handoff for the exact current student and project.'
      inputSchema = @{ type = 'object'; properties = @{
        sessionId = @{ type = 'string'; minLength = 1; maxLength = 240 }
        handoffId = @{ type = 'string'; minLength = 1; maxLength = 240 }
        targetProject = @{ type = 'string'; maxLength = 240 }
      }; required = @('sessionId', 'handoffId'); additionalProperties = $false }
    }
  )
}

function Resolve-MemoryProjectId {
  param([object]$Config, [string]$TargetProject)
  $requested = [string]$TargetProject
  if ([string]::IsNullOrWhiteSpace($requested)) { return '' }
  $matches = @($Config.defaults.projects | Where-Object { ([string]$_.id -eq $requested.Trim()) -or ([string]$_.name -eq $requested.Trim()) })
  if ($matches.Count -ne 1) { throw 'The target project must exactly match one project linked to the current student.' }
  return [string]$matches[0].id
}

function Invoke-MemoryTool {
  param([string]$Name, [object]$Arguments)
  $config = Read-Descriptor
  $projectId = Resolve-MemoryProjectId -Config $config -TargetProject ([string]$Arguments.targetProject)
  $body = @{
    studentId = [string]$config.defaults.scopeId
    projectId = $projectId
    sessionId = [string]$Arguments.sessionId
    idempotencyKey = [string]$Arguments.idempotencyKey
    sourceAgent = [string]$Arguments.sourceAgent
    agentId = [string]$Arguments.sourceAgent
  }
  $endpoint = ''
  switch ($Name) {
    'get_recent_education_context' {
      $endpoint = [string]$config.memoryEndpoints.recent
      $body.limit = [int]$Arguments.limit
    }
    'start_education_session' {
      $endpoint = [string]$config.memoryEndpoints.start
      $body.title = [string]$Arguments.title
      $body.objective = [string]$Arguments.objective
    }
    'record_authorized_education_turn' {
      $endpoint = [string]$config.memoryEndpoints.append
      $body.messages = $Arguments.messages
    }
    'finalize_education_session' {
      $endpoint = [string]$config.memoryEndpoints.finalize
      $body.status = [string]$Arguments.status
      $body.summary = $Arguments.summary
      $body.messages = $Arguments.messages
      $body.handoff = @{ targetAgent = [string]$Arguments.targetAgent }
    }
    'accept_education_handoff' {
      $endpoint = [string]$config.memoryEndpoints.acceptHandoff
      $body.handoffId = [string]$Arguments.handoffId
    }
    'cancel_education_handoff' {
      $endpoint = [string]$config.memoryEndpoints.cancelHandoff
      $body.handoffId = [string]$Arguments.handoffId
    }
    default { throw "Unknown memory tool: $Name" }
  }
  if ([string]::IsNullOrWhiteSpace($endpoint)) { throw 'Education Manager memory endpoint is unavailable.' }
  $response = Invoke-EducationManagerApi -Config $config -Endpoint $endpoint -Body $body
  return @{
    content = @(@{ type = 'text'; text = ($response | ConvertTo-Json -Depth 20 -Compress) })
    structuredContent = $response
    isError = -not [bool]$response.ok
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

function Read-CapabilityCatalog {
  $config = Read-Descriptor
  $endpoint = [string]$config.capabilityCatalogEndpoint
  if (-not $endpoint.StartsWith('http://127.0.0.1:')) { throw 'Local capability catalog unavailable.' }
  $tokenPath = [string]$config.authentication.tokenFile
  if (-not (Test-Path -LiteralPath $tokenPath -PathType Leaf)) { throw 'The Education Manager credential is not ready.' }
  $token = (Get-Content -LiteralPath $tokenPath -Raw -Encoding UTF8).Trim()
  return Invoke-RestMethod -Method Get -Uri $endpoint -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 15
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
  $teamEnabled = ([string]$config.defaults.scopePolicy -ne 'fixed_student') -and ([bool]$config.teamQueryPolicy.allowLocalTeamKnowledgeQuery -or [bool]$config.teamQueryPolicy.allowRemoteTeamKnowledgeQuery)
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
  $targetProject = [string]$Arguments.targetProject
  $conversationInput = @{
    studentId = [string]$config.defaults.scopeId
    sourceAgent = $sourceAgent.Trim()
    sessionId = $sessionId.Trim()
    title = [string]$Arguments.title
    messages = @($Arguments.messages)
  }
  if ($Arguments.attachments -and @($Arguments.attachments).Count -gt 0) { throw 'Conversation preview does not accept attachments. Submit selected material through the host approval flow.' }
  $previewBody = @{ name = 'conversation.submit'; input = $conversationInput; targetProject = $targetProject.Trim() }
  $key = [string]$Arguments.idempotencyKey
  if ([string]::IsNullOrWhiteSpace($key)) {
    $payload = ($previewBody | ConvertTo-Json -Depth 20 -Compress)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { $key = ([BitConverter]::ToString($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($payload)))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
  }
  $endpoint = ([string]$config.capabilityEndpoint).Replace('/api/agent/invoke', '/api/agent/write/preview')
  if (-not $endpoint.StartsWith('http://127.0.0.1:')) { throw 'Local write preview endpoint unavailable.' }
  $previewBody.idempotencyKey = $key
  $result = Invoke-EducationManagerApi -Config $config -Endpoint $endpoint -Body $previewBody
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

function Invoke-WriteIntentTool {
  param([string]$Action, [object]$Arguments)
  $config = Read-Descriptor
  $endpoint = ([string]$config.capabilityEndpoint).Replace('/api/agent/invoke', "/api/agent/write/$Action")
  if (-not $endpoint.StartsWith('http://127.0.0.1:')) { throw 'Local write endpoint unavailable.' }
  $result = Invoke-EducationManagerApi -Config $config -Endpoint $endpoint -Body @{ intentId = [string]$Arguments.intentId }
  return @{ content = @(@{ type = 'text'; text = ($result | ConvertTo-Json -Depth 20 -Compress) }); structuredContent = $result; isError = -not [bool]$result.ok }
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
          capabilities = @{ tools = @{ listChanged = $false }; resources = @{ listChanged = $false } }
          serverInfo = @{ name = 'edu-manager-knowledge'; title = 'Education Manager Knowledge and Authorized Conversation Capture'; version = '1.3.0' }
          instructions = 'This credential is fixed to exactly one student and that student linked projects; never widen its scope. If automatic conversation memory is enabled, capture only this Agent current authorized conversation: call start_education_session once, call record_authorized_education_turn after every user/assistant turn with stable event IDs, then call finalize_education_session before ending. Set sourceAgent to codex, qclaw, workbuddy, openclaw, trae, or qoder-work as appropriate. Never read or submit earlier chats, unrelated conversations, system prompts, tool output secrets, caches, credentials, or Education Manager task-center execution context. Use submit_education_conversation only for an explicit one-off user request. Preserve edu:// citations.'
        }
      }
      'ping' { @{} }
      'tools/list' {
        $config = Read-Descriptor
        $tools = @((Knowledge-Tool-Definition -Config $config), (Conversation-Tool-Definition -Config $config))
        $agentPermissions = @($config.agentCapabilities | ForEach-Object { [string]$_ })
        if ($config.capabilityEndpoint -and $agentPermissions -contains 'archive:read') { $tools += @((Capability-Tool-Definitions)[0]) }
        if ($config.capabilityEndpoint -and $agentPermissions -contains 'task:read') { $tools += @((Capability-Tool-Definitions)[1]) }
        if ($config.capabilityEndpoint -and @($agentPermissions | Where-Object { $_ -in @('conversation:submit', 'material:upload', 'task:create', 'report:draft') }).Count -gt 0) {
          $tools += @(
            @{ name = 'execute_education_write'; title = 'Execute approved education write'; description = 'Execute only a previously previewed and host-approved intent. Never approve the intent yourself.'; inputSchema = @{ type = 'object'; properties = @{ intentId = @{ type = 'string'; minLength = 1 } }; required = @('intentId'); additionalProperties = $false } },
            @{ name = 'get_education_write_status'; title = 'Check education write status'; description = 'Read the status and receipt of an existing scoped intent.'; inputSchema = @{ type = 'object'; properties = @{ intentId = @{ type = 'string'; minLength = 1 } }; required = @('intentId'); additionalProperties = $false } }
          )
        }
        $tools += @(Memory-Tool-Definitions)
        @{ tools = $tools }
      }
      'resources/list' {
        $config = Read-Descriptor
        $resourceItems = @()
        if ($config.capabilityCatalogEndpoint) { $resourceItems = @(@{ uri = 'edu://agent/capabilities'; name = 'Authorized Education Manager capabilities'; mimeType = 'application/json' }) }
        @{ resources = $resourceItems }
      }
      'resources/read' {
        if ([string]$request.params.uri -ne 'edu://agent/capabilities') { throw 'Unknown MCP resource.' }
        $catalog = Read-CapabilityCatalog
        @{ contents = @(@{ uri = 'edu://agent/capabilities'; mimeType = 'application/json'; text = ($catalog | ConvertTo-Json -Depth 32 -Compress) }) }
      }
      'tools/call' {
        switch ([string]$request.params.name) {
          'query_education_knowledge' {
            Invoke-KnowledgeTool -Arguments $request.params.arguments
          }
          'list_education_archive' { Invoke-CapabilityTool -Name 'archive.list' -Arguments $request.params.arguments }
          'get_education_task_status' { Invoke-CapabilityTool -Name 'task.status' -Arguments $request.params.arguments }
          'execute_education_write' { Invoke-WriteIntentTool -Action 'execute' -Arguments $request.params.arguments }
          'get_education_write_status' { Invoke-WriteIntentTool -Action 'status' -Arguments $request.params.arguments }
          'submit_education_conversation' {
            Invoke-ConversationTool -Arguments $request.params.arguments
          }
          'get_recent_education_context' { Invoke-MemoryTool -Name 'get_recent_education_context' -Arguments $request.params.arguments }
          'start_education_session' { Invoke-MemoryTool -Name 'start_education_session' -Arguments $request.params.arguments }
          'record_authorized_education_turn' { Invoke-MemoryTool -Name 'record_authorized_education_turn' -Arguments $request.params.arguments }
          'finalize_education_session' { Invoke-MemoryTool -Name 'finalize_education_session' -Arguments $request.params.arguments }
          'accept_education_handoff' { Invoke-MemoryTool -Name 'accept_education_handoff' -Arguments $request.params.arguments }
          'cancel_education_handoff' { Invoke-MemoryTool -Name 'cancel_education_handoff' -Arguments $request.params.arguments }
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
