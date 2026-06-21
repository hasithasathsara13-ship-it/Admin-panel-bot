"use client";

import { ChatInterface } from "../../components/ChatInterface";

export default function MessagesPage() {
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-x-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ChatInterface />
      </div>
    </div>
  );
}
