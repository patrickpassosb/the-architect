import { spawn, type ChildProcess } from "node:child_process";
import type { Readable } from "node:stream";

export interface SandboxError {
  code: "docker_not_found" | "image_not_found" | "docker_not_running" | "permission_denied" | "timeout" | "unknown";
  message: string;
  hint?: string;
}

function categorizeSandboxError(error: Error, stderr: string): SandboxError {
  const message = error.message.toLowerCase();
  const stderrLower = stderr.toLowerCase();
  
  if (message.includes("enoent") || message.includes("not found") || message.includes("command not found")) {
    if (message.includes("docker")) {
      return {
        code: "docker_not_found",
        message: "Docker executable not found",
        hint: "Ensure Docker is installed and in your PATH. On macOS, open Docker Desktop. On Linux, ensure the docker daemon is running."
      };
    }
  }
  
  if (message.includes("econnrefused") || message.includes("connection refused")) {
    return {
      code: "docker_not_running",
      message: "Docker is not running",
      hint: "Start Docker Desktop or the docker daemon. You may need to run 'sudo systemctl start docker' on Linux."
    };
  }
  
  if (message.includes("permission denied") || message.includes("eacces") || message.includes("epermission")) {
    return {
      code: "permission_denied",
      message: "Permission denied to run Docker",
      hint: "Ensure your user has permission to run Docker. On Linux, add your user to the 'docker' group: sudo usermod -aG docker $USER"
    };
  }
  
  if (stderrLower.includes("no such image") || stderrLower.includes("image not found")) {
    return {
      code: "image_not_found",
      message: `Sandbox image not found`,
      hint: "Build the image with: docker build -t architect-vibe-image -f infra/Dockerfile.sandbox ."
    };
  }
  
  return {
    code: "unknown",
    message: error.message,
    hint: "Check that Docker is running and the SANDBOX_DOCKER_IMAGE is correct."
  };
}

function stripAnsi(str: string): string {
  return str.replace(
    /[\x1b\x9b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
    ""
  );
}

function extractToolCallInfo(toolCall: unknown): { name: string; summary: string; filePath?: string } {
  const tc = toolCall as { function?: { name?: string; arguments?: string } };
  const name = tc.function?.name || "unnamed";
  let summary = "";
  let filePath: string | undefined;

  try {
    if (tc.function?.arguments) {
      const args = JSON.parse(tc.function.arguments);
      
      switch (name) {
        case "write_file":
        case "write":
          filePath = args.file_path || args.path || args.filename;
          const content = args.content || "";
          const lines = content.split("\n").length;
          summary = `${filePath} (${lines} lines)`;
          break;
        case "read_file":
        case "read":
          filePath = args.file_path || args.path || args.filename;
          summary = filePath || "unknown";
          break;
        case "bash":
        case "shell":
        case "run":
          const cmd = args.command || args.cmd || "";
          summary = cmd.slice(0, 80) + (cmd.length > 80 ? "..." : "");
          break;
        case "grep":
        case "search":
          const pattern = args.pattern || args.query || "";
          const path = args.file_path || args.path || ".";
          summary = `"${pattern.slice(0, 30)}" in ${path}`;
          break;
        case "mkdir":
        case "create_directory":
          filePath = args.dir_path || args.path || args.directory;
          summary = filePath || "unknown";
          break;
        case "remove_file":
        case "delete_file":
          filePath = args.file_path || args.path;
          summary = `Deleted: ${filePath}`;
          break;
        default:
          const argKeys = Object.keys(args).filter(k => !["api_key", "secret", "password", "token"].includes(k.toLowerCase()));
          if (argKeys.length > 0) {
            summary = argKeys.slice(0, 2).map(k => `${k}=${String(args[k]).slice(0, 30)}`).join(", ");
          }
      }
    }
  } catch {
    // Failed to parse arguments
  }

  return { name, summary, filePath };
}

interface ParsedToolCall {
  name: string;
  summary: string;
  filePath?: string;
}

function parseToolCallLine(line: string): { toolCall?: ParsedToolCall; isToolResult?: boolean } {
  try {
    const parsed = JSON.parse(line);
    
    if (parsed.tool_calls && Array.isArray(parsed.tool_calls) && parsed.tool_calls.length > 0) {
      const toolInfos = parsed.tool_calls.map((tc: unknown) => extractToolCallInfo(tc));
      const hasFileChanges = toolInfos.some((t: ParsedToolCall) => t.filePath);
      
      return {
        toolCall: toolInfos[0],
        isToolResult: false
      };
    }
    
    if (parsed.name && parsed.content) {
      const info = extractToolCallInfo({ function: { name: parsed.name, arguments: parsed.content } });
      if (info.filePath) {
        return { isToolResult: true };
      }
    }
  } catch {
    // Not JSON
  }
  
  return {};
}

export interface SandboxConfig {
  image: string;
  memoryLimit: string;
  cpuLimit: number;
  workdir: string;
}

export interface SpawnResult {
  exitCode: number | null;
  timedOut: boolean;
  output: string;
}

export interface StreamingContext {
  publisher: {
    publish: (channel: string, message: string) => Promise<number>;
  };
  channel: string;
  agentLabel: string;
}

export async function runVibeInSandbox(
  sessionId: string,
  prompt: string,
  config: SandboxConfig,
  options: {
    maxTurns: number;
    dryRun: boolean;
    timeoutMs: number;
    streaming?: StreamingContext;
  }
): Promise<SpawnResult> {
  const containerName = `architect-build-${sessionId}-${Date.now()}`;
  
  const dockerArgs = [
    "run",
    "--rm",
    "--name", containerName,
    "--memory", config.memoryLimit,
    "--cpus", config.cpuLimit.toString(),
    "-v", `${config.workdir}:/workspace`,
    "--workdir", "/workspace",
    config.image,
    "vibe",
    "--workdir", "/workspace",
    "-p", prompt,
    "--max-turns", options.maxTurns.toString(),
    "--output", "streaming"
  ];

  if (options.dryRun) {
    dockerArgs.push("--agent", "plan");
  } else {
    dockerArgs.push("--agent", "auto-approve");
  }

  return new Promise((resolve, reject) => {
    const child = spawn("docker", dockerArgs, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let stdoutBuffer = "";
    let stderrBuffer = "";

    const publishLine = (line: string, isToolResult = false) => {
      if (options.streaming && line.trim()) {
        let displayData = line;
        let fileChange: { path: string; action: "created" | "modified" } | undefined;
        
        try {
          const parsed = JSON.parse(line);
          
          if (parsed.content) {
            displayData = parsed.content;
          } else if (parsed.tool_calls && Array.isArray(parsed.tool_calls) && parsed.tool_calls.length > 0) {
            const toolCalls = parsed.tool_calls as unknown[];
            const toolInfos = toolCalls.map(tc => extractToolCallInfo(tc));
            
            if (toolInfos.length === 1 && toolInfos[0].summary) {
              displayData = `[Tool] ${toolInfos[0].name} → ${toolInfos[0].summary}`;
            } else {
              displayData = `[Tool] ${toolInfos.map(t => t.name).join(", ")}`;
            }
            
            const writeTool = toolInfos.find(t => t.name === "write_file" || t.name === "write");
            if (writeTool?.filePath) {
              fileChange = { path: writeTool.filePath, action: "created" };
            }
          } else if (parsed.role === "user") {
            return;
          } else if (parsed.role === "assistant" && !parsed.content && !parsed.tool_calls) {
            return;
          } else if (isToolResult) {
            try {
              const resultParsed = JSON.parse(parsed.content || "{}");
              if (resultParsed.file_path || resultParsed.path) {
                fileChange = { path: resultParsed.file_path || resultParsed.path, action: "modified" };
              }
            } catch {
              // Not JSON result
            }
          }
        } catch {
          displayData = stripAnsi(line);
        }

        displayData = stripAnsi(displayData);

        const message = JSON.stringify({
          type: "build_log",
          agent: options.streaming.agentLabel,
          data: displayData
        });
        options.streaming.publisher.publish(options.streaming.channel, message).catch(() => {});
        
        if (fileChange) {
          const fileMsg = JSON.stringify({
            type: "build_log",
            agent: options.streaming.agentLabel,
            data: `📝 ${fileChange.action === "created" ? "Created" : "Modified"}: ${fileChange.path}`
          });
          options.streaming.publisher.publish(options.streaming.channel, fileMsg).catch(() => {});
        }
      }
    };

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, 5_000).unref();
    }, options.timeoutMs);

    const handleData = (data: Buffer, buffer: string, isStdout: boolean) => {
      const text = data.toString("utf8");
      if (isStdout) {
        stdout += text;
      } else {
        stderr += text;
      }
      buffer += text;
      const lines = buffer.split("\n");
      const remaining = lines.pop() ?? "";
      for (const line of lines) {
        publishLine(line);
      }
      return remaining;
    };

    child.stdout?.on("data", (data: Buffer) => {
      stdoutBuffer = handleData(data, stdoutBuffer, true);
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderrBuffer = handleData(data, stderrBuffer, false);
    });

    child.on("error", (error) => {
      clearTimeout(timeoutHandle);
      const categorized = categorizeSandboxError(error, stderr);
      const enhancedError = new Error(categorized.message);
      (enhancedError as Error & { code?: string }).code = categorized.code;
      (enhancedError as Error & { hint?: string }).hint = categorized.hint;
      reject(enhancedError);
    });

    child.on("close", (exitCode) => {
      clearTimeout(timeoutHandle);
      if (stdoutBuffer.trim()) publishLine(stdoutBuffer);
      if (stderrBuffer.trim()) publishLine(stderrBuffer);
      
      if (options.streaming) {
        const doneMessage = JSON.stringify({
          type: "build_done",
          agent: options.streaming.agentLabel,
          exit_code: exitCode,
          timed_out: timedOut
        });
        options.streaming.publisher.publish(options.streaming.channel, doneMessage).catch(() => {});
      }
      
      const joined = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n\n");
      const maxLength = 30_000;
      const output = joined.length > maxLength ? joined.slice(-maxLength) : joined;
      
      resolve({
        exitCode,
        timedOut,
        output
      });
    });
  });
}

export async function cleanupStaleContainers(prefix: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["ps", "-a", "-q", "--filter", `name=${prefix}`], {
      stdio: ["ignore", "pipe", "ignore"]
    });

    let output = "";
    child.stdout?.on("data", (data: Buffer) => {
      output += data.toString();
    });

    child.on("close", async (code) => {
      if (code !== 0) {
        resolve();
        return;
      }

      const containerIds = output.trim().split("\n").filter(Boolean);
      if (containerIds.length === 0) {
        resolve();
        return;
      }

      for (const id of containerIds) {
        await new Promise<void>((res) => {
          const rm = spawn("docker", ["rm", "-f", id], { stdio: "ignore" });
          rm.on("close", () => res());
        });
      }
      resolve();
    });

    child.on("error", () => resolve());
  });
}
