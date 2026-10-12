export interface Fields {
  'System.Title': string;
  'System.State': string;
  'System.WorkItemType': string;
  'System.TeamProject': string;
  'System.AssignedTo'?: { displayName: string; uniqueName: string };
  'System.IterationPath'?: string;
  'System.AreaPath'?: string;
  'System.Tags'?: string;
  'System.Parent'?: number;
  'System.Description'?: string;
  'Microsoft.VSTS.Common.Priority'?: number;
  'Microsoft.VSTS.Common.AcceptanceCriteria'?: string;
  'Microsoft.VSTS.TCM.ReproSteps'?: string;
}
export interface WorkItem { org: string; id: number; fields: Fields }
export interface Comment { text: string; createdDate: string; createdBy?: { displayName: string } }
