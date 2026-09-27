"use client";

import { useState } from "react";
import { Plus, X, Users, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Agent } from "@/lib/types";

interface SubAgentsSectionProps {
  subAgents: { id: string; name: string }[];
  setSubAgents: (subAgents: { id: string; name: string }[]) => void;
  existingAgents: Agent[];
  currentAgentId?: string;
}

export function SubAgentsSection({
  subAgents,
  setSubAgents,
  existingAgents,
  currentAgentId,
}: SubAgentsSectionProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);

  const availableAgents = existingAgents.filter(
    (agent) =>
      agent.id !== currentAgentId &&
      agent.active &&
      !subAgents.some((sa) => sa.id === agent.id),
  );

  const filteredAgents = availableAgents.filter((agent) =>
    agent.name.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  const handleAddAgents = () => {
    const newSubAgents = existingAgents
      .filter((agent) => selectedAgents.includes(agent.id))
      .map((agent) => ({ id: agent.id, name: agent.name }));

    setSubAgents([...subAgents, ...newSubAgents]);
    setSelectedAgents([]);
    setIsDialogOpen(false);
  };

  const handleRemoveAgent = (id: string) => {
    setSubAgents(subAgents.filter((sa) => sa.id !== id));
  };

  const toggleSelection = (id: string) => {
    setSelectedAgents((prev) =>
      prev.includes(id) ? prev.filter((aid) => aid !== id) : [...prev, id],
    );
  };

  return (
    <section id="agent-sub-agents" className="space-y-5 scroll-mt-6">
      <div className="flex items-start gap-4">
        <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary/8 text-primary shrink-0 mt-0.5">
          <Users className="h-4.5 w-4.5" />
        </div>
        <div className="space-y-1 min-w-0">
          <h2 className="text-lg font-semibold text-foreground tracking-tight">
            Sub Agents
          </h2>
          <p className="text-[13px] text-foreground/50 leading-relaxed">
            Assign other agents to work as sub-agents for this agent.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {subAgents.map((agent) => (
          <div
            key={agent.id}
            className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-input-border bg-card-bg/50 group hover:border-primary/20 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="h-7 w-7 rounded-full bg-primary/8 flex items-center justify-center">
                <Bot className="h-3.5 w-3.5 text-primary" />
              </div>
              <span className="font-medium text-sm text-foreground">
                {agent.name}
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => handleRemoveAgent(agent.id)}
              className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity hover:text-red-500 hover:bg-red-500/10 rounded-md"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}

        <button
          onClick={() => setIsDialogOpen(true)}
          className="flex items-center justify-center py-2.5 rounded-lg border border-dashed border-input-border hover:border-primary/30 hover:bg-primary/5 transition-all min-h-[52px] text-sm font-medium text-foreground/40 hover:text-primary gap-2"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Sub Agent
        </button>

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Sub Agents</DialogTitle>
              <DialogDescription>
                Select agents to add as sub-agents.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <Input
                placeholder="Search agents..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />

              <div className="max-h-[300px] overflow-y-auto space-y-1">
                {filteredAgents.length === 0 ? (
                  <p className="text-sm text-center text-foreground/40 py-8">
                    No agents found.
                  </p>
                ) : (
                  filteredAgents.map((agent) => (
                    <div
                      key={agent.id}
                      className="flex items-center space-x-2 p-2 rounded-lg hover:bg-hover-bg cursor-pointer"
                      onClick={() => toggleSelection(agent.id)}
                    >
                      <Checkbox
                        checked={selectedAgents.includes(agent.id)}
                        onCheckedChange={() => toggleSelection(agent.id)}
                      />
                      <div className="flex-1 text-sm font-medium leading-none text-foreground">
                        {agent.name}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleAddAgents}
                disabled={selectedAgents.length === 0}
              >
                Add Selected
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </section>
  );
}
