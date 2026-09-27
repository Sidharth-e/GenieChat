
import { logger } from "@/lib/logger";
import { useState, useCallback, useRef, useEffect } from 'react';
import { Workflow, WorkflowExecution } from '@/lib/types';
import { StepStatus } from '@/components/workflow/workflow-execution-viewer';

export interface UseWorkflowRunReturn {
    isExecuting: boolean;
    isComplete: boolean;
    stepStatuses: StepStatus[];
    finalResult: string | null;
    currentExecutionId: string | null;
    startRun: (message?: string) => Promise<void>;
    resetRun: () => void;
    // For resuming/viewing existing runs
    loadExecution: (execution: WorkflowExecution) => void;
}

export function useWorkflowRun(workflow: Workflow | null): UseWorkflowRunReturn {
    const steps = workflow?.steps ?? [];

    const [isExecuting, setIsExecuting] = useState(false);
    const [isComplete, setIsComplete] = useState(false);
    const [finalResult, setFinalResult] = useState<string | null>(null);
    const [currentExecutionId, setCurrentExecutionId] = useState<string | null>(null);

    const [stepStatuses, setStepStatuses] = useState<StepStatus[]>(
        steps.map(() => ({ status: 'pending', tools: [] }))
    );

    useEffect(() => {
        if (steps.length > 0) {
            setStepStatuses(steps.map(() => ({ status: 'pending', tools: [] })));
        }
    }, [steps.length]);

    const resetRun = useCallback(() => {
        setIsExecuting(false);
        setIsComplete(false);
        setFinalResult(null);
        setCurrentExecutionId(null);
        setStepStatuses(steps.map(() => ({ status: 'pending', tools: [] })));
    }, [steps]);

    const loadExecution = useCallback((execution: WorkflowExecution) => {
        setCurrentExecutionId(execution.id);
        setIsExecuting(execution.status === 'running');
        setIsComplete(execution.status === 'completed' || execution.status === 'error');
        setFinalResult(execution.finalOutput || null);

        const loadedStatuses: StepStatus[] = steps.map((step, index) => {
            const execStep = execution.steps.find(s => s.stepId === step.id) || execution.steps[index];

            if (!execStep) return { status: 'pending', tools: [] };

            return {
                status: execStep.status === 'running' ? 'running' :
                    execStep.status === 'completed' ? 'completed' :
                        execStep.status === 'error' ? 'error' : 'pending',
                result: execStep.output,
                error: execStep.error,
                // We'd need to map tool calls if we want to show history there
                tools: execStep.toolCalls?.map(tc => ({
                    name: tc.name,
                    args: tc.arguments,
                    result: tc.result,
                    status: tc.result ? 'completed' : 'running'
                })) || [],
                duration: execStep.startTime && execStep.endTime
                    ? Math.round((new Date(execStep.endTime).getTime() - new Date(execStep.startTime).getTime()) / 1000)
                    : undefined
            };
        });

        setStepStatuses(loadedStatuses);
    }, [steps]);

    // Polling for background execution updates
    const isStreamingRef = useRef(false);

    useEffect(() => {
        let intervalId: NodeJS.Timeout;

        const pollStatus = async () => {
            if (!currentExecutionId || !isExecuting || isStreamingRef.current) return;

            try {
                // We only need the latest execution status
                // But specifically for the current ID
                // The current API doesn't support fetching a single execution by ID directly in the client easily 
                // without knowing the structure, but we can list executions. 
                // Ideally we'd have GET /api/executions/[id] but we have /api/workflows/[id]/executions

                const res = await fetch(`/api/workflows/${workflow?.id}/executions`);
                if (res.ok) {
                    const executions: WorkflowExecution[] = await res.json();
                    const current = executions.find(e => e.id === currentExecutionId);

                    if (current) {
                        // If status changed or steps updated, reload
                        // This is a simple brute-force update. 
                        // To be smoother we might want to compare, but loadExecution handles state update reasonably well.
                        loadExecution(current);

                        if (current.status !== 'running') {
                            setIsExecuting(false);
                            setIsComplete(true);
                        }
                    }
                }
            } catch (error) {
                logger.error("Polling error:", error);
            }
        };

        if (isExecuting && currentExecutionId) {
            intervalId = setInterval(pollStatus, 2000);
        }

        return () => {
            if (intervalId) clearInterval(intervalId);
        };
    }, [isExecuting, currentExecutionId, workflow?.id, loadExecution]);

    const startRun = async (userMessage?: string) => {
        resetRun();
        setIsExecuting(true);
        isStreamingRef.current = true;

        try {
            if (!workflow) return;
            const response = await fetch(`/api/workflows/${workflow.id}/execute`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: userMessage || "Execute workflow" }),
            });

            if (!response.ok) {
                throw new Error("Failed to execute workflow");
            }

            const reader = response.body?.getReader();
            const decoder = new TextDecoder();

            if (!reader) return;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n').filter(line => line.trim());

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));

                            if (data.type === 'workflow_start') {
                                if (data.finalResult) {
                                    setCurrentExecutionId(data.finalResult);
                                }
                            }
                            else if (data.type === 'step_start') {
                                setStepStatuses(prev => prev.map((s, i) =>
                                    i === data.stepIndex ? { ...s, status: 'running', streamingContent: '' } : s
                                ));
                            }
                            else if (data.type === 'step_token') {
                                setStepStatuses(prev => prev.map((s, i) =>
                                    i === data.stepIndex
                                        ? { ...s, streamingContent: (s.streamingContent || '') + data.content }
                                        : s
                                ));
                            }
                            else if (data.type === 'tool_call_start') {
                                setStepStatuses(prev => prev.map((s, i) => {
                                    if (i === data.stepIndex) {
                                        return {
                                            ...s,
                                            tools: [...s.tools, {
                                                name: data.toolName,
                                                args: data.toolArgs,
                                                status: 'running'
                                            }]
                                        };
                                    }
                                    return s;
                                }));
                            }
                            else if (data.type === 'tool_result') {
                                setStepStatuses(prev => prev.map((s, i) => {
                                    if (i === data.stepIndex) {
                                        const pendingToolIndex = s.tools.findIndex(t => t.status === 'running');
                                        if (pendingToolIndex !== -1) {
                                            const newTools = [...s.tools];
                                            newTools[pendingToolIndex] = {
                                                ...newTools[pendingToolIndex],
                                                result: data.toolResult,
                                                status: 'completed'
                                            };
                                            return { ...s, tools: newTools };
                                        }
                                    }
                                    return s;
                                }));
                            }
                            else if (data.type === 'step_complete') {
                                setStepStatuses(prev => prev.map((s, i) => {
                                    if (i === data.stepIndex) {
                                        // Use local tracking for duration if available, otherwise backend duration
                                        const duration = data.duration;
                                        return {
                                            ...s,
                                            status: 'completed',
                                            result: data.result,
                                            streamingContent: undefined,
                                            duration,
                                        };
                                    }
                                    return s;
                                }));
                            }
                            else if (data.type === 'step_error') {
                                setStepStatuses(prev => prev.map((s, i) =>
                                    i === data.stepIndex ? { ...s, status: 'error', error: data.error } : s
                                ));
                            }
                            else if (data.type === 'workflow_complete') {
                                setFinalResult(data.finalResult);
                                setIsComplete(true);
                            }
                        } catch {
                            // Skip invalid JSON
                        }
                    }
                }
            }
        } catch (error) {
            logger.error("Execution error:", error);
            // Could set global error state here
        } finally {
            setIsExecuting(false);
            isStreamingRef.current = false;
        }
    };

    return {
        isExecuting,
        isComplete,
        stepStatuses,
        finalResult,
        currentExecutionId,
        startRun,
        resetRun,
        loadExecution
    };
}
