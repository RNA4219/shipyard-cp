/**
 * GraphQL queries and mutations for GitHub Projects v2 API
 */
export const QUERIES = {
  getProject: `
    query($owner: String!, $number: Int!) {
      organization(login: $owner) {
        projectV2(number: $number) {
          id
          number
          title
          shortDescription
          public
          closed
          fields(first: 100) {
            nodes {
              ... on ProjectV2Field {
                id
                name
                dataType
              }
              ... on ProjectV2SingleSelectField {
                id
                name
                dataType
                options {
                  id
                  name
                  color
                }
              }
              ... on ProjectV2IterationField {
                id
                name
                dataType
              }
            }
          }
          owner {
            ... on Organization {
              login
            }
            ... on User {
              login
            }
          }
        }
      }
    }
  `,

  getProjectItem: `
    query($projectId: ID!, $itemId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          item(id: $itemId) {
            id
            createdAt
            updatedAt
            content {
              ... on Issue {
                title
                number
                state
                body
                url
              }
              ... on PullRequest {
                title
                number
                state
                body
                url
              }
              ... on DraftIssue {
                title
                body
              }
            }
            fieldValues(first: 50) {
              nodes {
                ... on ProjectV2ItemFieldTextValue {
                  field { id name }
                  text: value
                }
                ... on ProjectV2ItemFieldNumberValue {
                  field { id name }
                  number: value
                }
                ... on ProjectV2ItemFieldDateValue {
                  field { id name }
                  date: value
                }
                ... on ProjectV2ItemFieldSingleSelectValue {
                  field { id name }
                  value: name
                  optionId
                }
              }
            }
          }
        }
      }
    }
  `,
};

export const MUTATIONS = {
  addDraftIssue: `
    mutation($projectId: ID!, $title: String!, $body: String) {
      addProjectV2DraftIssue(input: {
        projectId: $projectId
        title: $title
        body: $body
      }) {
        projectItem {
          id
          createdAt
          updatedAt
          content {
            ... on DraftIssue {
              title
              body
            }
          }
        }
      }
    }
  `,

  addProjectItem: `
    mutation($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: {
        projectId: $projectId
        contentId: $contentId
      }) {
        item {
          id
          createdAt
          updatedAt
          content {
            ... on Issue {
              title
              number
              state
              body
              url
            }
            ... on PullRequest {
              title
              number
              state
              body
              url
            }
          }
        }
      }
    }
  `,

  updateTextField: `
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: { text: $value }
      }) {
        projectV2Item {
          id
        }
      }
    }
  `,

  updateNumberField: `
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: Float!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: { number: $value }
      }) {
        projectV2Item {
          id
        }
      }
    }
  `,

  updateDateField: `
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: { date: $value }
      }) {
        projectV2Item {
          id
        }
      }
    }
  `,

  updateSingleSelectField: `
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: { singleSelectOptionId: $value }
      }) {
        projectV2Item {
          id
        }
      }
    }
  `,

  updateIterationField: `
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId
        itemId: $itemId
        fieldId: $fieldId
        value: { iterationId: $value }
      }) {
        projectV2Item {
          id
        }
      }
    }
  `,

  deleteItem: `
    mutation($projectId: ID!, $itemId: ID!) {
      deleteProjectV2Item(input: {
        projectId: $projectId
        itemId: $itemId
      }) {
        deletedItemId
      }
    }
  `,
};