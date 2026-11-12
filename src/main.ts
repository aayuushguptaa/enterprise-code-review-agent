import * as dotenv from 'dotenv';
import { logger, logReviewStart, logReviewError } from './utils/logger.js';
import { ReviewError, ErrorCodes, formatError } from './utils/error-handler.js';

// Load environment variables
dotenv.config();

/**
 * Main entry point for the Claude Multi-Agent Code Review System
 * Usage: npm run dev <owner> <repo> <pr-number>
 */
async function main() {
  const [owner, repo, prStr] = process.argv.slice(2);

  try {
    // =========================================================================
    // TODO 1: Validate command line arguments
    // =========================================================================
    if (!owner || !repo || !prStr) {
      throw new ReviewError(
        'Missing required arguments. Usage: npm run dev <owner> <repo> <pr-number>\n' +
        'Example: npm run dev facebook react 12345',
        ErrorCodes.INVALID_CONFIG
      );
    }

    const prNumber = parseInt(prStr, 10);
    if (isNaN(prNumber) || prNumber <= 0) {
      throw new ReviewError(
        `Invalid pull request number: "${prStr}". Must be a positive integer.\n` +
        'Example: npm run dev facebook react 12345',
        ErrorCodes.INVALID_CONFIG
      );
    }

    // =========================================================================
    // TODO 2: Validate authentication (Anthropic API or AWS Bedrock)
    // =========================================================================
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    const awsAccessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const awsSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    const awsRegion = process.env.AWS_REGION;

    // Check if using AWS Bedrock
    if (awsAccessKeyId && awsSecretAccessKey) {
      if (!awsRegion) {
        throw new ReviewError(
          'AWS_REGION environment variable is required when using AWS Bedrock authentication',
          ErrorCodes.MISSING_API_KEY,
          { missingVar: 'AWS_REGION' }
        );
      }
      logger.info('🔐 Using AWS Bedrock authentication', {
        region: awsRegion,
        accessKeyId: awsAccessKeyId.substring(0, 10) + '***'
      });
    }
    // Check if using Anthropic API
    else if (anthropicApiKey) {
      logger.info('🔐 Using Anthropic API authentication', {
        apiKeyPrefix: anthropicApiKey.substring(0, 10) + '***'
      });
    }
    // Neither method configured
    else {
      throw new ReviewError(
        'No authentication credentials found. Please configure ONE of:\n' +
        '  1. Anthropic API: Set ANTHROPIC_API_KEY environment variable\n' +
        '  2. AWS Bedrock: Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_REGION\n' +
        'Example .env file:\n' +
        '  ANTHROPIC_API_KEY=sk-ant-your-key-here\n' +
        '  OR\n' +
        '  AWS_ACCESS_KEY_ID=your-access-key\n' +
        '  AWS_SECRET_ACCESS_KEY=your-secret-key\n' +
        '  AWS_REGION=us-west-2',
        ErrorCodes.MISSING_API_KEY
      );
    }

    // =========================================================================
    // TODO 3: Validate ANTHROPIC_MODEL environment variable
    // =========================================================================
    const anthropicModel = process.env.ANTHROPIC_MODEL;
    if (!anthropicModel) {
      throw new ReviewError(
        'ANTHROPIC_MODEL environment variable is required.\n' +
        'Set one of:\n' +
        '  - For Anthropic API: ANTHROPIC_MODEL=claude-sonnet-4-5-20250929\n' +
        '  - For AWS Bedrock: ANTHROPIC_MODEL=us.anthropic.claude-sonnet-4-5-20250929-v1:0',
        ErrorCodes.MISSING_API_KEY,
        { missingVar: 'ANTHROPIC_MODEL' }
      );
    }

    logger.info('✅ Validation passed', {
      owner,
      repo,
      prNumber,
      model: anthropicModel
    });

    // =========================================================================
    // Phase 1 Complete - Ready for Phase 2
    // =========================================================================
    console.log('\n' + '='.repeat(60));
    console.log('Claude Multi-Agent Code Review System');
    console.log('='.repeat(60));
    console.log(`\n📋 Reviewing PR: ${owner}/${repo}#${prNumber}`);
    console.log(`🤖 Model: ${anthropicModel}`);
    console.log(`\n⏳ Phase 1: Validation - COMPLETE ✅`);
    console.log(`📍 Phase 2: Orchestrator - Starting...\n`);

    // =========================================================================
    // Phase 2: Create orchestrator and run review
    // =========================================================================
    const { CodeReviewOrchestrator } = await import('./orchestrator.js');
    const { ReportGenerator } = await import('./utils/report-generator.js');
    const fsModule = await import('fs');
    const pathModule = await import('path');

    const fs = fsModule.default || fsModule;
    const path = pathModule.default || pathModule;

    // Create orchestrator instance
    const orchestrator = new CodeReviewOrchestrator({
      model: anthropicModel,
      projectRoot: process.env.PROJECT_ROOT
    });

    // Run the code review
    console.log('⏳ Analyzing pull request...');
    const reviewReport = await orchestrator.reviewPullRequest(owner, repo, prNumber);

    console.log('✅ Review complete!\n');
    console.log(`📊 Summary:`);
    console.log(`   Overall Score: ${reviewReport.summary.overallScore}/100`);
    console.log(`   Files Reviewed: ${reviewReport.summary.totalFiles}`);
    console.log(`   Critical Issues: ${reviewReport.summary.criticalIssues}`);
    console.log(`   High Priority Tests: ${reviewReport.summary.highPriorityTests}`);
    console.log(`   Refactoring Opportunities: ${reviewReport.summary.refactoringOpportunities}\n`);

    // =========================================================================
    // Phase 5: Generate formatted reports
    // =========================================================================
    console.log('📄 Generating reports...');
    const reportGenerator = new ReportGenerator();

    // Create reports directory if it doesn't exist
    const reportsDir = path.join(process.cwd(), 'reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    // Generate all report formats
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportBaseName = `${owner}-${repo}-${prNumber}-${timestamp}`;

    // Markdown report for GitHub comments
    const markdownReport = reportGenerator.generateMarkdownReport(reviewReport);
    const mdPath = path.join(reportsDir, `${reportBaseName}.md`);
    fs.writeFileSync(mdPath, markdownReport);
    console.log(`   ✓ Markdown report: ${mdPath}`);

    // HTML report for web display
    const htmlReport = reportGenerator.generateHTMLReport(reviewReport);
    const htmlPath = path.join(reportsDir, `${reportBaseName}.html`);
    fs.writeFileSync(htmlPath, htmlReport);
    console.log(`   ✓ HTML report: ${htmlPath}`);

    // JSON report for programmatic access
    const jsonReport = reportGenerator.generateJSONReport(reviewReport);
    const jsonPath = path.join(reportsDir, `${reportBaseName}.json`);
    fs.writeFileSync(jsonPath, jsonReport);
    console.log(`   ✓ JSON report: ${jsonPath}`);

    console.log('\n' + '='.repeat(60));
    console.log('✅ Code Review Complete!');
    console.log('='.repeat(60));
    console.log(`\nReports saved to: ${reportsDir}/`);
    console.log(`View the HTML report in your browser or GitHub PR comments\n`);

  } catch (error) {
    const formattedError = formatError(error);
    console.error('\n❌ Error:', formattedError);

    if (error instanceof ReviewError) {
      logger.error('Configuration error', {
        code: error.code,
        message: error.message,
        metadata: error.metadata
      });
    } else {
      logger.error('Unexpected error', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
    }

    process.exit(1);
  }
}

main();
