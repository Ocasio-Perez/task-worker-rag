import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Alert,
  App,
  Badge,
  Button,
  Card,
  Col,
  ConfigProvider,
  Descriptions,
  Empty,
  Layout,
  Row,
  Space,
  Table,
  Tag,
  Typography,
  theme,
} from "antd";
import {
  ApiOutlined,
  CheckCircleOutlined,
  CodeOutlined,
  DatabaseOutlined,
  GithubOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import "./styles.css";

const { Header, Content } = Layout;
const { Text, Title } = Typography;

function Dashboard() {
  const [status, setStatus] = useState(null);
  const [repos, setRepos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const [statusResponse, reposResponse] = await Promise.all([
        fetch("/api/dashboard/status"),
        fetch("/api/dashboard/repos"),
      ]);

      if (!statusResponse.ok) throw new Error(`status ${statusResponse.status}`);
      if (!reposResponse.ok) throw new Error(`repos ${reposResponse.status}`);

      const statusJson = await statusResponse.json();
      const reposJson = await reposResponse.json();
      setStatus(statusJson);
      setRepos(Array.isArray(reposJson.repos) ? reposJson.repos : []);
    } catch (err) {
      setError(err.message || "Dashboard request failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const checks = status?.checks || [];
  const failedChecks = checks.filter((check) => !check.ok);
  const repoCount = repos.length;
  const indexedRepos = repos.filter((repo) => Number(repo.indexed_chunks) > 0).length;

  const columns = useMemo(
    () => [
      {
        title: "Repo",
        dataIndex: "name",
        key: "name",
        render: (name, repo) => (
          <Space direction="vertical" size={0}>
            <Text strong>{name}</Text>
            <Text type="secondary" className="mono small">
              {repo.path}
            </Text>
          </Space>
        ),
      },
      {
        title: "Git",
        key: "git",
        width: 160,
        render: (_, repo) =>
          repo.git ? (
            <Space>
              <GithubOutlined />
              <Text>{repo.branch || "detached"}</Text>
              <Badge status={repo.dirty ? "warning" : "success"} />
            </Space>
          ) : (
            <Tag>not git</Tag>
          ),
      },
      {
        title: "Indexed Chunks",
        dataIndex: "indexed_chunks",
        key: "indexed_chunks",
        width: 160,
        render: (value) =>
          value === null || value === undefined ? (
            <Tag color="default">unknown</Tag>
          ) : Number(value) > 0 ? (
            <Tag color="green">{value}</Tag>
          ) : (
            <Tag color="red">0</Tag>
          ),
      },
      {
        title: "Commands",
        key: "commands",
        width: 300,
        render: (_, repo) => (
          <Space direction="vertical" size={2}>
            <Text copyable className="mono small">
              /code-status {repo.name}
            </Text>
            <Text copyable className="mono small">
              /code-search {repo.name} "query" 5
            </Text>
            <Text copyable className="mono small">
              npm run sync-and-reindex -- {repo.name}
            </Text>
          </Space>
        ),
      },
    ],
    []
  );

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: "#2563eb",
          borderRadius: 6,
          fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
        },
      }}
    >
      <App>
        <Layout className="shell">
          <Header className="topbar">
            <Space align="center" className="brand">
              <DatabaseOutlined />
              <Title level={4}>Task Worker RAG</Title>
              <Tag color={status?.ok ? "green" : "red"}>{status?.ok ? "healthy" : "attention"}</Tag>
            </Space>
            <Button icon={<ReloadOutlined />} onClick={refresh} loading={loading}>
              Refresh
            </Button>
          </Header>

          <Content className="content">
            {error ? (
              <Alert type="error" showIcon message="Dashboard request failed" description={error} className="block" />
            ) : null}

            <Row gutter={[16, 16]} className="block">
              <Col xs={24} md={8}>
                <MetricCard
                  icon={<CheckCircleOutlined />}
                  title="Service Checks"
                  value={`${checks.length - failedChecks.length}/${checks.length}`}
                  status={failedChecks.length ? "warning" : "success"}
                />
              </Col>
              <Col xs={24} md={8}>
                <MetricCard icon={<CodeOutlined />} title="Repos" value={repoCount} status="processing" />
              </Col>
              <Col xs={24} md={8}>
                <MetricCard icon={<ApiOutlined />} title="Indexed Repos" value={indexedRepos} status="success" />
              </Col>
            </Row>

            <Row gutter={[16, 16]} className="block">
              <Col xs={24} lg={14}>
                <Card title="Checks" loading={loading}>
                  {checks.length ? (
                    <Space direction="vertical" className="full" size={8}>
                      {checks.map((check) => (
                        <div className="check-row" key={check.name}>
                          <Badge status={check.ok ? "success" : "error"} />
                          <Text strong>{check.name}</Text>
                          <Text type="secondary">{check.detail}</Text>
                        </div>
                      ))}
                    </Space>
                  ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  )}
                </Card>
              </Col>
              <Col xs={24} lg={10}>
                <Card title="Runtime" loading={loading}>
                  <Descriptions size="small" column={1}>
                    <Descriptions.Item label="Repo root">
                      <Text className="mono">{status?.config?.repo_root || "-"}</Text>
                    </Descriptions.Item>
                    <Descriptions.Item label="Chroma">
                      <Text className="mono">{status?.config?.chroma_url || "-"}</Text>
                    </Descriptions.Item>
                    <Descriptions.Item label="Collection">
                      <Text className="mono">{status?.config?.chroma_collection || "-"}</Text>
                    </Descriptions.Item>
                    <Descriptions.Item label="Ollama">
                      <Text className="mono">{status?.config?.ollama_host || "-"}</Text>
                    </Descriptions.Item>
                    <Descriptions.Item label="Embedding">
                      <Text className="mono">{status?.config?.ollama_embed_model || "-"}</Text>
                    </Descriptions.Item>
                  </Descriptions>
                </Card>
              </Col>
            </Row>

            <Card title="Repository Corpus" loading={loading}>
              <Table
                rowKey="name"
                columns={columns}
                dataSource={repos}
                pagination={false}
                scroll={{ x: 980 }}
                locale={{ emptyText: "No repositories found under REPO_ROOT" }}
              />
            </Card>
          </Content>
        </Layout>
      </App>
    </ConfigProvider>
  );
}

function MetricCard({ icon, title, value, status }) {
  return (
    <Card className="metric">
      <Space align="center">
        <Badge status={status} />
        <span className="metric-icon">{icon}</span>
        <Space direction="vertical" size={0}>
          <Text type="secondary">{title}</Text>
          <Title level={3}>{value}</Title>
        </Space>
      </Space>
    </Card>
  );
}

createRoot(document.getElementById("root")).render(<Dashboard />);
