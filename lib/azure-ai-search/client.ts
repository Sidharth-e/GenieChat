import {
    AzureKeyCredential,
    SearchClient,
    SearchIndexClient,
    SearchIndexerClient,
} from "@azure/search-documents";
import { config } from "@/lib/config";

export const AzureAISearchCredentials = () => {
    const apiKey = config.azureSearch.apiKey;
    const searchName = config.azureSearch.name;
    if (!apiKey || !searchName) {
        throw new Error(
            "One or more Azure AI Search environment variables are not set"
        );
    }

    const endpoint = `https://${searchName}.search.windows.net`;
    return {
        apiKey,
        endpoint,
    };
};

export const AzureAISearchInstance = <T extends object>(indexName: string) => {
    const { apiKey, endpoint } = AzureAISearchCredentials();

    const searchClient = new SearchClient<T>(
        endpoint,
        indexName,
        new AzureKeyCredential(apiKey)
    );

    return searchClient;
};

export const AzureAISearchIndexClientInstance = () => {
    const { apiKey, endpoint } = AzureAISearchCredentials();

    const searchClient = new SearchIndexClient(
        endpoint,
        new AzureKeyCredential(apiKey)
    );

    return searchClient;
};

export const AzureAISearchIndexerClientInstance = () => {
    const { apiKey, endpoint } = AzureAISearchCredentials();

    const client = new SearchIndexerClient(
        endpoint,
        new AzureKeyCredential(apiKey)
    );

    return client;
};
